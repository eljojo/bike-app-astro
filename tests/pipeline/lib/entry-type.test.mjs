import { describe, it, expect } from 'vitest';
import { deriveEntryType, waysLengthM, isLongDistance } from '../../../scripts/pipeline/lib/entry-type.mjs';

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

  it('short mtb-trail without relation → not destination', () => {
    // Parc Lattion: pipeline-named unnamed chain, no OSM relation, short.
    // MTB trails go through the same length threshold as MUPs/trails.
    expect(deriveEntryType({
      path_type: 'mtb-trail', mtb: true, _ways: makeWays(0.001),
    })).not.toBe('destination');
  });

  it('long mtb-trail without relation → destination', () => {
    expect(deriveEntryType({
      path_type: 'mtb-trail', mtb: true, _ways: makeWays(0.02),
    })).toBe('destination');
  });

  it('short mtb-trail with relation → destination', () => {
    // An OSM cycling relation means someone gave this trail real-world identity
    expect(deriveEntryType({
      path_type: 'mtb-trail', mtb: true, osm_relations: [12345], _ways: makeWays(0.001),
    })).toBe('destination');
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
});
