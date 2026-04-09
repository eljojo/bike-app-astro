import { describe, it, expect } from 'vitest';
import { deriveEntryType, waysLengthM, isLongDistance, isSkiOnlyEntry } from '../../../scripts/pipeline/lib/entry-type.mjs';

// Helper: make a simple straight-line _ways array of ~N metres
// 1 degree lat ≈ 111,320m, so 0.001° ≈ 111m
function makeWays(lengthDeg) {
  return [[
    { lat: 45.4, lon: -75.7 },
    { lat: 45.4 + lengthDeg, lon: -75.7 },
  ]];
}

describe('waysLengthM', () => {
  it('returns 0 for empty/missing _ways', () => {
    expect(waysLengthM(null)).toBe(0);
    expect(waysLengthM([])).toBe(0);
  });

  it('computes length for a simple straight line', () => {
    const ways = makeWays(0.01); // ~1.1km
    const len = waysLengthM(ways);
    expect(len).toBeGreaterThan(1000);
    expect(len).toBeLessThan(1200);
  });
});

describe('isLongDistance', () => {
  it('rcn with short relation → false (rcn alone is not long-distance)', () => {
    expect(isLongDistance({ network: 'rcn', osm_relations: [1], _ways: makeWays(0.01) })).toBe(false);
  });

  it('rcn with long relation → true', () => {
    expect(isLongDistance({ network: 'rcn', osm_relations: [1], _ways: makeWays(0.6) })).toBe(true);
  });

  it('ncn with relation and long geometry → true', () => {
    expect(isLongDistance({ network: 'ncn', osm_relations: [1], _ways: makeWays(0.5) })).toBe(true);
  });

  it('ncn with relation but short (4.4km bike lane) → false', () => {
    // Trans Canada Trail (Sussex Drive): 4.4km bike lane tagged ncn — not long-distance
    expect(isLongDistance({ network: 'ncn', osm_relations: [7369782], ref: 'TCT', path_type: 'bike-lane', _ways: makeWays(0.04) })).toBe(false);
  });

  it('ncn with relation but medium (14.9km MUP) → false', () => {
    // Ottawa River Pathway (Trans Canada Trail): 14.9km MUP tagged ncn — not long-distance
    expect(isLongDistance({ network: 'ncn', osm_relations: [9502633], ref: 'TCT', path_type: 'mup', _ways: makeWays(0.134) })).toBe(false);
  });

  it('≥30km with relation → true', () => {
    expect(isLongDistance({ _ways: makeWays(0.28), osm_relations: [1], path_type: 'mup' })).toBe(true);
  });

  it('≥30km with ref → true', () => {
    expect(isLongDistance({ _ways: makeWays(0.28), ref: 'T1', path_type: 'mup' })).toBe(true);
  });

  it('≥30km without relation or ref → false', () => {
    expect(isLongDistance({ _ways: makeWays(0.28), path_type: 'mup' })).toBe(false);
  });

  it('short path without network tags → false', () => {
    expect(isLongDistance({ _ways: makeWays(0.01), path_type: 'mup' })).toBe(false);
  });

  it('already type: long-distance → true', () => {
    expect(isLongDistance({ type: 'long-distance' })).toBe(true);
  });

  it('MTB trail with large geometry → false (MTB is always local)', () => {
    // Gatineau Park MTB trail system: 95 ways, big relation, but it's a local trail network
    expect(isLongDistance({ mtb: true, path_type: 'mtb-trail', osm_relations: [1], _ways: makeWays(0.5) })).toBe(false);
  });

  it('MTB trail with NCN tag → true (long-distance route on rough terrain)', () => {
    // Sentier Trans-Canada Gatineau-Montréal: MTB-rideable section of the Trans Canada Trail
    expect(isLongDistance({ mtb: true, path_type: 'mtb-trail', network: 'ncn', osm_relations: [1], _ways: makeWays(0.5) })).toBe(true);
  });
});

describe('deriveEntryType', () => {
  it('skips network entries', () => {
    expect(deriveEntryType({ type: 'network' })).toBeUndefined();
  });

  it('skips trail entries', () => {
    expect(deriveEntryType({ type: 'long-distance' })).toBeUndefined();
  });

  // --- Trails (long-distance routes) ---

  it('long ncn route with relation → trail', () => {
    expect(deriveEntryType({
      network: 'ncn', osm_relations: [12345], path_type: 'mup', _ways: makeWays(0.5),
    })).toBe('long-distance');
  });

  it('short ncn route with relation → destination (not long-distance)', () => {
    // 4.4km bike lane on Sussex Drive tagged ncn/TCT — just a local segment
    expect(deriveEntryType({
      network: 'ncn', osm_relations: [7369782], ref: 'TCT', path_type: 'bike-lane', _ways: makeWays(0.04),
    })).toBe('destination');
  });

  it('medium ncn route with relation → destination (not long-distance)', () => {
    // 14.9km MUP section of TCT — part of a network, not a standalone long-distance route
    expect(deriveEntryType({
      network: 'ncn', osm_relations: [9502633], ref: 'TCT', path_type: 'mup', _ways: makeWays(0.134),
    })).toBe('destination');
  });

  it('short rcn route with relation → destination (not long-distance)', () => {
    expect(deriveEntryType({
      network: 'rcn', osm_relations: [12345], path_type: 'mup', _ways: makeWays(0.01),
    })).toBe('destination');
  });

  it('ncn without relation → not long-distance (falls to other rules)', () => {
    expect(deriveEntryType({
      network: 'ncn', path_type: 'mup', _ways: makeWays(0.01),
    })).not.toBe('long-distance');
  });

  it('long route with ref code (>50km) → long-distance', () => {
    expect(deriveEntryType({
      osm_relations: [12345], ref: 'PPJ 1', path_type: 'mup', _ways: makeWays(0.5), // ~55km
    })).toBe('long-distance');
  });

  it('short route with ref code (<50km) → destination, not long-distance', () => {
    expect(deriveEntryType({
      osm_relations: [12345], ref: 'X1', path_type: 'mup', _ways: makeWays(0.01), // ~1km
    })).toBe('destination');
  });

  it('path ≥30km with relation → long-distance', () => {
    expect(deriveEntryType({
      path_type: 'mup', _ways: makeWays(0.28), osm_relations: [1], // ~31km
    })).toBe('long-distance');
  });

  it('path ≥30km without relation or ref → not long-distance', () => {
    expect(deriveEntryType({
      path_type: 'mup', _ways: makeWays(0.28), // ~31km, no identity
    })).not.toBe('long-distance');
  });

  it('path just under 30km → not long-distance', () => {
    expect(deriveEntryType({
      path_type: 'mup', _ways: makeWays(0.25), osm_names: ['Some Trail'], // ~28km
    })).toBe('destination');
  });

  // --- Destinations ---

  it('entries with osm_relations (no network tag) → destination', () => {
    expect(deriveEntryType({
      osm_relations: [12345], path_type: 'mup', _ways: makeWays(0.001),
    })).toBe('destination');
  });

  // --- MTB trail classification ---
  // Uses _discovery_source to distinguish real trails from pipeline artifacts.

  it('mtb-trail member of network → destination', () => {
    expect(deriveEntryType({
      path_type: 'mtb-trail', mtb: true, member_of: 'parc-de-la-gatineau',
      _ways: makeWays(0.001),
    })).toBe('destination');
  });

  it('tiny mtb-trail member of network → still destination', () => {
    expect(deriveEntryType({
      path_type: 'mtb-trail', mtb: true, member_of: 'south-march-highlands',
      _ways: makeWays(0.0003),
    })).toBe('destination');
  });

  it('mtb-trail with osm_relations → destination', () => {
    expect(deriveEntryType({
      path_type: 'mtb-trail', mtb: true, osm_relations: [12345],
      _ways: makeWays(0.001),
    })).toBe('destination');
  });

  it('mtb-trail unnamed-chain → infrastructure', () => {
    // Parc Lattion: pipeline-generated name from park polygon
    expect(deriveEntryType({
      path_type: 'mtb-trail', mtb: true, _discovery_source: 'unnamed-chain',
      _ways: makeWays(0.02),
    })).toBe('infrastructure');
  });

  it('mtb-trail unnamed-chain member of network → destination (member_of wins)', () => {
    expect(deriveEntryType({
      path_type: 'mtb-trail', mtb: true, _discovery_source: 'unnamed-chain',
      member_of: 'some-network', _ways: makeWays(0.001),
    })).toBe('destination');
  });

  it('long mtb-trail named-way → destination', () => {
    expect(deriveEntryType({
      path_type: 'mtb-trail', mtb: true, _discovery_source: 'named-way',
      _ways: makeWays(0.02),
    })).toBe('destination');
  });

  it('short mtb-trail named-way → connector', () => {
    // Community Pump Track: real OSM name, but 43m
    expect(deriveEntryType({
      path_type: 'mtb-trail', mtb: true, _discovery_source: 'named-way',
      _ways: makeWays(0.001),
    })).toBe('connector');
  });

  it('long MUP → destination', () => {
    expect(deriveEntryType({
      path_type: 'mup', _ways: makeWays(0.02), osm_names: ['Some Path'],
    })).toBe('destination');
  });

  it('long trail → destination', () => {
    expect(deriveEntryType({
      path_type: 'trail', _ways: makeWays(0.015),
    })).toBe('destination');
  });

  // --- Infrastructure ---

  it('bike-lane on a real road → infrastructure', () => {
    expect(deriveEntryType({
      path_type: 'bike-lane', _ways: makeWays(0.005),
    })).toBe('infrastructure');
  });

  it('paved-shoulder → infrastructure', () => {
    expect(deriveEntryType({
      path_type: 'paved-shoulder', _ways: makeWays(0.005),
    })).toBe('infrastructure');
  });

  it('short named MUP → infrastructure', () => {
    expect(deriveEntryType({
      path_type: 'mup', _ways: makeWays(0.005), osm_names: ['Short Path'],
    })).toBe('infrastructure');
  });

  // --- Connectors ---

  it('tiny bike-lane → connector', () => {
    expect(deriveEntryType({
      path_type: 'bike-lane', _ways: makeWays(0.001),
    })).toBe('connector');
  });

  it('short unnamed MUP → connector', () => {
    expect(deriveEntryType({
      path_type: 'mup', _ways: makeWays(0.001),
    })).toBe('connector');
  });

  // --- Thresholds ---

  it('respects custom destination threshold', () => {
    // 500m MUP: connector at default 1000m, destination at custom 400m
    expect(deriveEntryType({
      path_type: 'mup', _ways: makeWays(0.005),
    })).not.toBe('destination');

    expect(deriveEntryType({
      path_type: 'mup', _ways: makeWays(0.005),
    }, { destinationLengthM: 400 })).toBe('destination');
  });

  // --- Real-world spot checks ---

  it('Sawmill Creek Pathway (relation, no network tag) → destination', () => {
    expect(deriveEntryType({
      osm_relations: [7369960], path_type: 'mup', _ways: makeWays(0.02),
    })).toBe('destination');
  });

  it('Route Verte 1 (ncn relation) → trail', () => {
    expect(deriveEntryType({
      network: 'ncn', osm_relations: [416115], ref: 'RV1', path_type: 'mup',
      _ways: makeWays(0.5),
    })).toBe('long-distance');
  });

  it('Algonquin Trail (rcn relation) → trail', () => {
    expect(deriveEntryType({
      network: 'rcn', osm_relations: [9351875], ref: 'AL', path_type: 'mup',
      _ways: makeWays(0.5),
    })).toBe('long-distance');
  });

  it('Trilby Court (short bike-lane) → connector', () => {
    expect(deriveEntryType({
      path_type: 'bike-lane', _ways: makeWays(0.0005), // ~55m
    })).toBe('connector');
  });

  it('Bank Street (long bike-lane) → infrastructure', () => {
    expect(deriveEntryType({
      path_type: 'bike-lane', _ways: makeWays(0.03), // ~3.3km
    })).toBe('infrastructure');
  });

  // --- Ski-only belt (ski/piste trails should never become page-worthy) ---

  it('Piste 12 (Gatineau Park Nordic trail, slipped through) → connector', () => {
    // highway=path, piste:type=nordic, no bicycle tag, assigned to a park
    // by auto-grouping. Without the belt this would be a 'destination' page.
    expect(deriveEntryType({
      name: 'Piste 12',
      _piste_type: 'nordic',
      highway: 'path',
      member_of: 'parc-de-la-gatineau',
      path_type: 'mtb-trail',
      _ways: makeWays(0.02),
    })).toBe('connector');
  });

  it('entry with explicit bicycle=no → connector', () => {
    // Trail 18 case — piste:type=nordic bicycle=no. Even without a piste
    // signal present, bicycle=no alone is enough to exclude.
    expect(deriveEntryType({
      name: 'Trail 18',
      bicycle: 'no',
      highway: 'path',
      path_type: 'trail',
      _ways: makeWays(0.02),
    })).toBe('connector');
  });

  it('Trail #3 (piste:type=nordic + bicycle=designated + mtb:scale) → destination', () => {
    // Summer MTB / winter groomed trail. The piste signal alone must not
    // trigger the belt — cycling evidence makes this a legitimate entry.
    expect(deriveEntryType({
      name: 'Trail #3',
      _piste_type: 'nordic',
      bicycle: 'designated',
      highway: 'path',
      mtb: true,
      member_of: 'parc-de-la-gatineau',
      path_type: 'mtb-trail',
      _ways: makeWays(0.02),
    })).toBe('destination');
  });

  it('Ottawa River Pathway (piste:type=nordic + highway=cycleway) → destination', () => {
    // A real cycleway groomed for cross-country skiing in winter. The
    // cycleway highway tag is implicit bicycle=designated; must not trip
    // the belt.
    expect(deriveEntryType({
      name: 'Ottawa River Pathway',
      _piste_type: 'nordic',
      highway: 'cycleway',
      path_type: 'mup',
      _ways: makeWays(0.134), // ~14.9km
      osm_relations: [9502633],
    })).toBe('destination');
  });

  it("Le P'tit Train du Nord (promoted route=piste relation) → destination", () => {
    // Relation 6871774 is tagged route=piste piste:type=nordic but 56 of 61
    // member ways are highway=cycleway bicycle=designated. resolve.ts
    // promotes it when ≥90% of members are bikeable. The promoted entry has
    // no _piste_type (promotion doesn't run extractOsmMetadata) so the belt
    // must not fire, AND the belt must respect osm_relations as cycling
    // evidence anyway.
    expect(deriveEntryType({
      name: "Le P'tit Train du Nord",
      osm_relations: [6871774],
      route_type: 'piste',
      path_type: 'mup',
      _ways: makeWays(0.1),
    })).toBe('destination');
  });

  it('hypothetical promoted relation that still has piste leakage → destination', () => {
    // Defensive: even if a future enrichment path leaks _piste_type onto a
    // promoted relation entry, osm_relations is treated as cycling evidence.
    expect(deriveEntryType({
      name: "Le P'tit Train du Nord",
      osm_relations: [6871774],
      _piste_type: 'nordic',
      route_type: 'piste',
      path_type: 'mup',
      _ways: makeWays(0.1),
    })).toBe('destination');
  });
});

describe('isSkiOnlyEntry', () => {
  it('returns false for nullish / empty entries', () => {
    expect(isSkiOnlyEntry(null)).toBe(false);
    expect(isSkiOnlyEntry(undefined)).toBe(false);
    expect(isSkiOnlyEntry({})).toBe(false);
  });

  it('explicit bicycle=no → true', () => {
    expect(isSkiOnlyEntry({ bicycle: 'no', highway: 'path' })).toBe(true);
  });

  it('piste signal without cycling evidence → true', () => {
    expect(isSkiOnlyEntry({ _piste_type: 'nordic', highway: 'path' })).toBe(true);
    expect(isSkiOnlyEntry({ _piste_name: '12', highway: 'path' })).toBe(true);
  });

  it('piste signal with bicycle=designated → false', () => {
    expect(isSkiOnlyEntry({ _piste_type: 'nordic', bicycle: 'designated', highway: 'path' })).toBe(false);
  });

  it('piste signal on highway=cycleway → false', () => {
    expect(isSkiOnlyEntry({ _piste_type: 'nordic', highway: 'cycleway' })).toBe(false);
  });

  it('piste signal with osm_relations present → false (relation promotion path)', () => {
    expect(isSkiOnlyEntry({ _piste_type: 'nordic', osm_relations: [6871774] })).toBe(false);
  });

  it('no piste signal and no bicycle deny → false', () => {
    expect(isSkiOnlyEntry({ highway: 'path', path_type: 'trail' })).toBe(false);
  });
});
