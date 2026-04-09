import { describe, it, expect } from 'vitest';
import {
  NETWORK_LABELS,
  computeCenter,
  buildPathFacts,
  buildNetworkFacts,
  findNearestMajorPath,
  factLabelKey,
  localizeFactValue,
  localizeNetworkFactValue,
  type NetworkFact,
} from '../src/lib/bike-paths/bike-path-facts';

describe('NETWORK_LABELS', () => {
  it('maps rcn to network_regional', () => {
    expect(NETWORK_LABELS['rcn']).toBe('network_regional');
  });

  it('maps ncn to network_national', () => {
    expect(NETWORK_LABELS['ncn']).toBe('network_national');
  });

  it('maps lcn to network_local', () => {
    expect(NETWORK_LABELS['lcn']).toBe('network_local');
  });

  it('returns undefined for unknown network codes', () => {
    expect(NETWORK_LABELS['icn']).toBeUndefined();
  });
});

describe('computeCenter', () => {
  it('returns undefined for empty array', () => {
    expect(computeCenter([])).toBeUndefined();
  });

  it('returns the single point for one-element array', () => {
    expect(computeCenter([{ lat: 45.4, lng: -75.7 }])).toEqual([45.4, -75.7]);
  });

  it('averages multiple points', () => {
    const result = computeCenter([
      { lat: 45.0, lng: -75.0 },
      { lat: 46.0, lng: -76.0 },
    ]);
    expect(result).toEqual([45.5, -75.5]);
  });

  it('averages three points', () => {
    const result = computeCenter([
      { lat: 0, lng: 0 },
      { lat: 3, lng: 6 },
      { lat: 6, lng: 12 },
    ]);
    expect(result).toEqual([3, 6]);
  });
});

describe('buildPathFacts', () => {
  it('returns empty array for minimal meta', () => {
    expect(buildPathFacts({})).toEqual([]);
  });

  // --- path_info: path_type + width (surface is a separate fact) ---

  it('path_info has path_type and width, surface is separate', () => {
    const facts = buildPathFacts({ path_type: 'mup', surface: 'asphalt', width: '3' });
    expect(facts[0]).toEqual({ key: 'path_info', value: 'mup::3' });
    expect(facts.some(f => f.key === 'surface')).toBe(true);
  });

  it('path_info with path_type only', () => {
    const facts = buildPathFacts({ path_type: 'bike-lane' });
    expect(facts[0]).toEqual({ key: 'path_info', value: 'bike-lane::' });
  });

  it('surface only (no path_type) → surface fact, no path_info', () => {
    const facts = buildPathFacts({ surface: 'gravel' });
    expect(facts[0].key).toBe('surface');
    expect(facts.some(f => f.key === 'path_info')).toBe(false);
  });

  it('surface + width, no path_type → separate facts', () => {
    const facts = buildPathFacts({ surface: 'asphalt', width: '2.5' });
    // width alone triggers path_info
    expect(facts.some(f => f.key === 'path_info' && f.value === '::2.5')).toBe(true);
    expect(facts.some(f => f.key === 'surface')).toBe(true);
  });

  it('width only → path_info', () => {
    const facts = buildPathFacts({ width: '3' });
    expect(facts[0]).toEqual({ key: 'path_info', value: '::3' });
  });

  it('unknown surface values still produce a surface fact', () => {
    const facts = buildPathFacts({ surface: 'cobblestone' });
    expect(facts.some(f => f.key === 'surface' && f.value === 'cobblestone')).toBe(true);
  });

  it.each([
    'mup', 'separated-lane', 'bike-lane', 'paved-shoulder', 'mtb-trail', 'trail',
  ] as const)('path_info includes path_type %s', (type) => {
    const facts = buildPathFacts({ path_type: type });
    expect(facts[0].key).toBe('path_info');
    expect(facts[0].value).toMatch(new RegExp(`^${type}:`));
  });

  it('path_info strips outrageous widths (>6m likely road width)', () => {
    const facts = buildPathFacts({ path_type: 'bike-lane', surface: 'asphalt', width: '11' });
    expect(facts[0]).toEqual({ key: 'path_info', value: 'bike-lane::' });
  });

  it('path_info strips tiny widths (<0.3m not a real path)', () => {
    const facts = buildPathFacts({ path_type: 'mup', surface: 'asphalt', width: '0.1' });
    expect(facts[0]).toEqual({ key: 'path_info', value: 'mup::' });
  });

  it('path_info strips unparseable widths', () => {
    const facts = buildPathFacts({ path_type: 'mup', surface: 'ground', width: '1 mm' });
    expect(facts[0]).toEqual({ key: 'path_info', value: 'mup::' });
  });

  it('path_info keeps valid widths', () => {
    const facts = buildPathFacts({ path_type: 'mup', width: '3' });
    expect(facts[0]).toEqual({ key: 'path_info', value: 'mup::3' });
  });

  it('path_info keeps 0.5m width (narrow but real)', () => {
    const facts = buildPathFacts({ path_type: 'trail', width: '0.5' });
    expect(facts[0]).toEqual({ key: 'path_info', value: 'trail::0.5' });
  });

  it('no path_info when nothing available', () => {
    const facts = buildPathFacts({ lit: 'yes' });
    expect(facts.map(f => f.key)).not.toContain('path_info');
  });

  // --- traffic: combined separation + unusual access ---

  it('traffic: separated from both cars and peds', () => {
    const facts = buildPathFacts({ highway: 'cycleway', segregated: 'yes' });
    expect(facts).toContainEqual({ key: 'traffic_separated_all' });
  });

  it('traffic: separated from cars only', () => {
    const facts = buildPathFacts({ highway: 'cycleway' });
    expect(facts).toContainEqual({ key: 'traffic_separated_cars' });
  });

  it('traffic: separated from peds only (unusual)', () => {
    const facts = buildPathFacts({ segregated: 'yes' });
    expect(facts).toContainEqual({ key: 'traffic_separated_peds' });
  });

  it('no traffic fact when no separation', () => {
    const facts = buildPathFacts({ highway: 'path' });
    const keys = facts.map(f => f.key);
    expect(keys.every(k => !k.startsWith('traffic_'))).toBe(true);
  });

  it('traffic: bikes not allowed (unusual restriction)', () => {
    const facts = buildPathFacts({ bicycle: 'no' });
    expect(facts).toContainEqual({ key: 'traffic_no_bikes' });
  });

  it('mtb:true overrides bicycle:no (mtb trails allow bikes)', () => {
    const facts = buildPathFacts({ bicycle: 'no', mtb: true, path_type: 'mtb-trail' });
    const keys = facts.map(f => f.key);
    expect(keys).not.toContain('traffic_no_bikes');
  });

  it('traffic: dismount required', () => {
    const facts = buildPathFacts({ bicycle: 'dismount' });
    expect(facts).toContainEqual({ key: 'traffic_dismount' });
  });

  it('traffic: foot=no on cycleway → separated from all (not just cars)', () => {
    const facts = buildPathFacts({ highway: 'cycleway', foot: 'no' });
    expect(facts).toContainEqual({ key: 'traffic_separated_all' });
  });

  it('traffic: foot=no without cycleway → separated from peds only', () => {
    const facts = buildPathFacts({ highway: 'path', foot: 'no' });
    expect(facts).toContainEqual({ key: 'traffic_separated_peds' });
  });

  it('traffic: access=no + bicycle=designated → separated from peds (bike-only)', () => {
    const facts = buildPathFacts({ highway: 'cycleway', access: 'no', bicycle: 'designated' });
    expect(facts).toContainEqual({ key: 'traffic_separated_all' });
  });

  it('traffic: foot=designated does not imply ped separation', () => {
    const facts = buildPathFacts({ highway: 'cycleway', foot: 'designated' });
    // foot=designated means shared with pedestrians, not separated
    expect(facts).toContainEqual({ key: 'traffic_separated_cars' });
    expect(facts).not.toContainEqual({ key: 'traffic_separated_all' });
  });

  it('does not emit traffic for bicycle=yes or designated (redundant)', () => {
    for (const val of ['yes', 'designated']) {
      const facts = buildPathFacts({ bicycle: val });
      const keys = facts.map(f => f.key);
      expect(keys.every(k => !k.startsWith('traffic_'))).toBe(true);
    }
  });

  it('no traffic fact when segregated=no', () => {
    const facts = buildPathFacts({ segregated: 'no' });
    const keys = facts.map(f => f.key);
    expect(keys.every(k => !k.startsWith('traffic_'))).toBe(true);
  });

  // --- no separate highway/cycleway/bicycle facts ---

  it('does not emit separate highway fact', () => {
    const facts = buildPathFacts({ highway: 'path', path_type: 'mtb-trail' });
    expect(facts.map(f => f.key)).not.toContain('highway');
  });

  it('does not emit separate cycleway fact', () => {
    const facts = buildPathFacts({ cycleway: 'track', path_type: 'separated-lane' });
    expect(facts.map(f => f.key)).not.toContain('cycleway');
  });

  it('does not emit separate bicycle_designated or bicycle_yes', () => {
    const facts = buildPathFacts({ bicycle: 'designated' });
    const keys = facts.map(f => f.key);
    expect(keys).not.toContain('bicycle_designated');
    expect(keys).not.toContain('bicycle_yes');
  });

  // --- unchanged facts ---

  it('emits smoothness as standalone warning when no surface and bad+', () => {
    // good → dropped (expected default)
    expect(buildPathFacts({ smoothness: 'good' }).some(f => f.key.startsWith('smoothness_'))).toBe(false);
    // very_bad without surface → standalone warning
    expect(buildPathFacts({ smoothness: 'very_bad' })).toContainEqual({ key: 'smoothness_very_bad' });
  });

  it('does not emit smoothness when undefined', () => {
    const keys = buildPathFacts({ surface: 'asphalt' }).map(f => f.key);
    expect(keys.some(k => k.startsWith('smoothness_'))).toBe(false);
  });

  it('emits lit/not_lit', () => {
    expect(buildPathFacts({ lit: 'yes' })).toContainEqual({ key: 'lit' });
    expect(buildPathFacts({ lit: 'no' })).toContainEqual({ key: 'not_lit' });
  });

  it('emits terrain from elevation', () => {
    expect(buildPathFacts({ elevation_gain_m: 10 })).toContainEqual({ key: 'flat' });
    expect(buildPathFacts({ elevation_gain_m: 50 })).toContainEqual({ key: 'gentle_hills', value: '50' });
    expect(buildPathFacts({ elevation_gain_m: 120 })).toContainEqual({ key: 'hilly', value: '120' });
  });

  // --- incline as elevation fallback ---

  it('incline: 0% → flat (when no GPX elevation)', () => {
    expect(buildPathFacts({ incline: '0%' })).toContainEqual({ key: 'flat' });
  });

  it('incline: 3% → gentle_hills (without meters value)', () => {
    const facts = buildPathFacts({ incline: '3%' });
    const hill = facts.find(f => f.key === 'gentle_hills');
    expect(hill).toBeDefined();
    expect(hill!.value).toBeUndefined();
  });

  it('incline: >10% → hilly', () => {
    expect(buildPathFacts({ incline: '>10%' })).toContainEqual({ key: 'hilly' });
  });

  it('incline: "up" → gentle_hills (has slope, unknown magnitude)', () => {
    const facts = buildPathFacts({ incline: 'up' });
    expect(facts.find(f => f.key === 'gentle_hills')).toBeDefined();
  });

  it('incline: "down" → gentle_hills', () => {
    const facts = buildPathFacts({ incline: 'down' });
    expect(facts.find(f => f.key === 'gentle_hills')).toBeDefined();
  });

  it('GPX elevation_gain_m takes precedence over incline', () => {
    const facts = buildPathFacts({ elevation_gain_m: 10, incline: '>10%' });
    // Should be flat (from GPX), not hilly (from incline)
    expect(facts).toContainEqual({ key: 'flat' });
    expect(facts.find(f => f.key === 'hilly')).toBeUndefined();
  });

  it('emits operator', () => {
    expect(buildPathFacts({ operator: 'NCC' })).toContainEqual({ key: 'operator', value: 'NCC' });
  });

  it('emits network label for known codes', () => {
    expect(buildPathFacts({ network: 'rcn' })).toContainEqual({ key: 'network_regional' });
    expect(buildPathFacts({ network: 'ncn' })).toContainEqual({ key: 'network_national' });
    expect(buildPathFacts({ network: 'lcn' })).toContainEqual({ key: 'network_local' });
  });

  it('does not emit network for unknown code', () => {
    const keys = buildPathFacts({ network: 'unknown' }).map(f => f.key);
    expect(keys).not.toContain('network_regional');
    expect(keys).not.toContain('network_national');
    expect(keys).not.toContain('network_local');
  });

  it('emits parallel_to', () => {
    expect(buildPathFacts({ parallel_to: 'Bank Street' })).toContainEqual({ key: 'parallel_to', value: 'Bank Street' });
  });

  // --- access ---

  it('emits access_private for private land', () => {
    expect(buildPathFacts({ access: 'private' })).toContainEqual({ key: 'access_private' });
  });

  it('emits access_permissive for permissive access', () => {
    expect(buildPathFacts({ access: 'permissive' })).toContainEqual({ key: 'access_permissive' });
  });

  it('does not emit access fact for access=yes (normal)', () => {
    const keys = buildPathFacts({ access: 'yes' }).map(f => f.key);
    expect(keys.every(k => !k.startsWith('access_'))).toBe(true);
  });

  it('emits seasonal and inception (ref is hidden)', () => {
    expect(buildPathFacts({ seasonal: 'winter' })).toContainEqual({ key: 'seasonal', value: 'winter' });
    expect(buildPathFacts({ ref: 'RV1' }).some(f => f.key === 'ref')).toBe(false);
    expect(buildPathFacts({ inception: '1970s' })).toContainEqual({ key: 'inception', value: '1970s' });
  });

  it('builds full fact list for a rich path', () => {
    const facts = buildPathFacts({
      path_type: 'mup',
      surface: 'asphalt',
      smoothness: 'good',
      width: '3',
      highway: 'cycleway',
      segregated: 'yes',
      lit: 'yes',
      elevation_gain_m: 15,
      operator: 'NCC',
      network: 'ncn',
    });
    const keys = facts.map(f => f.key);
    expect(keys).toEqual([
      'path_info',       // mup + 3m wide
      'family_friendly', // paved lit MUP → family friendly (moved before surface)
      'surface',         // asphalt, no smoothness adj (good is dropped)
      'traffic_separated_all',
      'lit',
      'flat',
      'operator',
      'network_national',
    ]);
  });

  it('no longer emits mtb fact (replaced by path_type)', () => {
    expect(buildPathFacts({ mtb: true }).map(f => f.key)).not.toContain('mtb');
  });

  // --- surface_mix: mixed surface distributions ---

  it('emits surface_mixed fact when surface_mix is present', () => {
    const facts = buildPathFacts({
      surface: 'asphalt',
      path_type: 'mup',
      surface_mix: [
        { value: 'asphalt', km: 3 },
        { value: 'fine_gravel', km: 1 },
      ],
    });
    const mixed = facts.find(f => f.key === 'surface_mixed');
    expect(mixed).toBeDefined();
    expect(mixed!.breakdown).toEqual([
      { value: 'asphalt', km: 3 },
      { value: 'fine_gravel', km: 1 },
    ]);
  });

  it('path_info excludes surface even when surface_mix present', () => {
    const facts = buildPathFacts({
      surface: 'asphalt',
      path_type: 'mup',
      width: '3',
      surface_mix: [
        { value: 'asphalt', km: 3 },
        { value: 'fine_gravel', km: 1 },
      ],
    });
    expect(facts[0]).toEqual({ key: 'path_info', value: 'mup::3' });
    expect(facts.some(f => f.key === 'surface_mixed')).toBe(true);
  });

  it('does NOT emit surface_mixed when no surface_mix field', () => {
    const facts = buildPathFacts({ surface: 'asphalt', path_type: 'mup' });
    expect(facts.find(f => f.key === 'surface_mixed')).toBeUndefined();
  });

  // --- lit_mix: mixed lighting distributions ---

  it('emits lit_mixed fact when lit_mix has both yes and no', () => {
    const facts = buildPathFacts({
      lit: 'yes',
      lit_mix: [
        { value: 'yes', km: 2 },
        { value: 'no', km: 1 },
      ],
    });
    const mixed = facts.find(f => f.key === 'lit_mixed');
    expect(mixed).toBeDefined();
    expect(mixed!.breakdown).toEqual([
      { value: 'yes', km: 2 },
      { value: 'no', km: 1 },
    ]);
    expect(facts.find(f => f.key === 'lit')).toBeUndefined();
    expect(facts.find(f => f.key === 'not_lit')).toBeUndefined();
  });

  it('does NOT emit lit_mixed when no lit_mix field', () => {
    const facts = buildPathFacts({ lit: 'yes' });
    expect(facts.find(f => f.key === 'lit')).toBeDefined();
    expect(facts.find(f => f.key === 'lit_mixed')).toBeUndefined();
  });
});

describe('findNearestMajorPath', () => {
  const defaults = {
    pageSlug: 'trail-61',
    pageLengthKm: 1,
    hasMembers: false,
    memberSlugs: new Set<string>(),
  };

  it('picks the longest nearby path that is longer than the current path', () => {
    const result = findNearestMajorPath({
      ...defaults,
      connectedPaths: [],
      nearbyPaths: [
        { slug: 'greenbelt-pathway-east', name: 'Greenbelt Pathway East', length_km: 13.6, surface: 'gravel' },
        { slug: 'crosstown-3', name: 'Crosstown Bikeway 3', length_km: 5.2, surface: 'asphalt' },
      ],
    });
    expect(result).toBeDefined();
    expect(result!.slug).toBe('greenbelt-pathway-east');
  });

  it('prefers connected paths when they appear first (dedup)', () => {
    const result = findNearestMajorPath({
      ...defaults,
      connectedPaths: [
        { slug: 'greenbelt-pathway-east', name: 'Greenbelt Pathway East', length_km: 13.6 },
      ],
      nearbyPaths: [
        { slug: 'greenbelt-pathway-east', name: 'Greenbelt Pathway East', length_km: 13.6 },
        { slug: 'some-other', name: 'Some Other', length_km: 50 },
      ],
    });
    // some-other is longer, so it wins
    expect(result!.slug).toBe('some-other');
  });

  it('returns undefined when no candidate is longer than the current path', () => {
    const result = findNearestMajorPath({
      ...defaults,
      pageLengthKm: 20,
      connectedPaths: [
        { slug: 'short-one', name: 'Short One', length_km: 5 },
      ],
      nearbyPaths: [
        { slug: 'another-short', name: 'Another Short', length_km: 10 },
      ],
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined for network pages (hasMembers=true)', () => {
    const result = findNearestMajorPath({
      ...defaults,
      hasMembers: true,
      connectedPaths: [
        { slug: 'big-path', name: 'Big Path', length_km: 100 },
      ],
      nearbyPaths: [],
    });
    expect(result).toBeUndefined();
  });

  it('excludes own members', () => {
    const result = findNearestMajorPath({
      ...defaults,
      memberSlugs: new Set(['greenbelt-pathway-east']),
      connectedPaths: [],
      nearbyPaths: [
        { slug: 'greenbelt-pathway-east', name: 'Greenbelt Pathway East', length_km: 13.6 },
      ],
    });
    expect(result).toBeUndefined();
  });

  it('excludes self', () => {
    const result = findNearestMajorPath({
      ...defaults,
      connectedPaths: [],
      nearbyPaths: [
        { slug: 'trail-61', name: 'Trail 61', length_km: 50 },
      ],
    });
    expect(result).toBeUndefined();
  });

  it('includes same-network siblings (the whole point)', () => {
    const result = findNearestMajorPath({
      ...defaults,
      connectedPaths: [],
      nearbyPaths: [
        { slug: 'greenbelt-pathway-east', name: 'Greenbelt Pathway East', length_km: 13.6, memberOf: 'ncc-greenbelt' },
      ],
    });
    expect(result).toBeDefined();
    expect(result!.slug).toBe('greenbelt-pathway-east');
  });

  it('handles paths with no length_km (treated as 0)', () => {
    const result = findNearestMajorPath({
      ...defaults,
      pageLengthKm: undefined,
      connectedPaths: [],
      nearbyPaths: [
        { slug: 'no-length', name: 'No Length' },
      ],
    });
    // Both page and candidate have length 0, so candidate is NOT longer — excluded
    expect(result).toBeUndefined();
  });

  it('excludes own parent network', () => {
    const result = findNearestMajorPath({
      ...defaults,
      pageMemberOf: 'ncc-greenbelt',
      connectedPaths: [],
      nearbyPaths: [
        { slug: 'ncc-greenbelt', name: 'NCC Greenbelt', length_km: 118, memberOf: undefined },
        { slug: 'greenbelt-pathway-east', name: 'Greenbelt Pathway East', length_km: 13.6, memberOf: 'ncc-greenbelt' },
      ],
    });
    // Should pick the sibling path, not the parent network
    expect(result).toBeDefined();
    expect(result!.slug).toBe('greenbelt-pathway-east');
  });

  it('deduplicates across connected and nearby', () => {
    const result = findNearestMajorPath({
      ...defaults,
      connectedPaths: [
        { slug: 'dup', name: 'Dup Path', length_km: 10 },
      ],
      nearbyPaths: [
        { slug: 'dup', name: 'Dup Path', length_km: 10 },
      ],
    });
    // Should still pick it, just once
    expect(result).toBeDefined();
    expect(result!.slug).toBe('dup');
  });
});

describe('buildNetworkFacts', () => {
  it('returns unanimous surface when all members agree', () => {
    const facts = buildNetworkFacts([
      { surface: 'asphalt' },
      { surface: 'asphalt' },
      { surface: 'concrete' },  // different raw value but same category: "paved"
    ]);
    const surface = facts.find(f => f.key === 'surface');
    expect(surface).toBeDefined();
    expect(surface!.value).toBe('paved');
    expect(surface!.consistency).toBe('unanimous');
  });

  it('returns partial surface when some members lack surface data', () => {
    const facts = buildNetworkFacts([
      { surface: 'asphalt' },
      { surface: 'asphalt' },
      {},  // no surface data
    ]);
    const surface = facts.find(f => f.key === 'surface');
    expect(surface).toBeDefined();
    expect(surface!.consistency).toBe('partial');
  });

  it('returns mixed surface when members have different surface categories', () => {
    const facts = buildNetworkFacts([
      { surface: 'asphalt', length_km: 5 },
      { surface: 'fine_gravel', length_km: 3 },
      { surface: 'asphalt', length_km: 7 },
    ]);
    const surface = facts.find(f => f.key === 'surface_mixed');
    expect(surface).toBeDefined();
    expect(surface!.consistency).toBe('mixed');
    expect(surface!.breakdown).toHaveLength(2);
    // Paved should come first (12km > 3km)
    expect(surface!.breakdown![0]).toEqual({ value: 'paved', count: 2, km: 12 });
    expect(surface!.breakdown![1]).toEqual({ value: 'gravel', count: 1, km: 3 });
  });

  it('returns unanimous path_type when all members agree', () => {
    const facts = buildNetworkFacts([
      { path_type: 'mup' },
      { path_type: 'mup' },
      { path_type: 'mup' },
    ]);
    const pt = facts.find(f => f.key === 'path_type');
    expect(pt).toBeDefined();
    expect(pt!.value).toBe('mup');
    expect(pt!.consistency).toBe('unanimous');
  });

  it('returns partial path_type when some members lack it', () => {
    const facts = buildNetworkFacts([
      { path_type: 'bike-lane' },
      { path_type: 'bike-lane' },
      {},  // no path_type
    ]);
    const pt = facts.find(f => f.key === 'path_type');
    expect(pt).toBeDefined();
    expect(pt!.value).toBe('bike-lane');
    expect(pt!.consistency).toBe('partial');
  });

  it('returns mixed path_type with km breakdown', () => {
    const facts = buildNetworkFacts([
      { path_type: 'mup', length_km: 5.2 },
      { path_type: 'mup', length_km: 3.1 },
      { path_type: 'bike-lane', length_km: 2.5 },
      { path_type: 'trail', length_km: 1.0 },
    ]);
    const pt = facts.find(f => f.key === 'path_type_mixed');
    expect(pt).toBeDefined();
    expect(pt!.consistency).toBe('mixed');
    expect(pt!.breakdown).toHaveLength(3);
    // Sorted by km descending
    expect(pt!.breakdown![0]).toEqual({ value: 'mup', count: 2, km: 8.3 });
    expect(pt!.breakdown![1]).toEqual({ value: 'bike-lane', count: 1, km: 2.5 });
    expect(pt!.breakdown![2]).toEqual({ value: 'trail', count: 1, km: 1 });
  });

  it('path_type appears before surface in network facts', () => {
    const facts = buildNetworkFacts([
      { path_type: 'separated-lane', surface: 'asphalt' },
      { path_type: 'separated-lane', surface: 'asphalt' },
    ]);
    const keys = facts.map(f => f.key);
    const ptIdx = keys.indexOf('path_type');
    const surfIdx = keys.indexOf('surface');
    expect(ptIdx).toBeLessThan(surfIdx);
  });

  it('returns mixed lighting when members disagree', () => {
    const facts = buildNetworkFacts([
      { lit: 'yes' },
      { lit: 'no' },
      { lit: 'yes' },
    ]);
    const lit = facts.find(f => f.key === 'lit_mixed');
    expect(lit).toBeDefined();
    expect(lit!.consistency).toBe('mixed');
    expect(lit!.breakdown).toEqual([
      { value: 'lit', count: 2 },
      { value: 'not_lit', count: 1 },
    ]);
  });

  it('returns unanimous lit when all members are lit', () => {
    const facts = buildNetworkFacts([
      { lit: 'yes' },
      { lit: 'yes' },
    ]);
    const lit = facts.find(f => f.key === 'lit');
    expect(lit).toBeDefined();
    expect(lit!.consistency).toBe('unanimous');
  });

  it('returns unanimous operator when all members share same operator', () => {
    const facts = buildNetworkFacts([
      { operator: 'NCC' },
      { operator: 'NCC' },
    ]);
    const op = facts.find(f => f.key === 'operator');
    expect(op).toBeDefined();
    expect(op!.value).toBe('NCC');
    expect(op!.consistency).toBe('unanimous');
  });

  it('omits operator when members have different operators', () => {
    const facts = buildNetworkFacts([
      { operator: 'NCC' },
      { operator: 'City of Ottawa' },
    ]);
    expect(facts.find(f => f.key === 'operator')).toBeUndefined();
  });

  it('returns separated_cars when all members are cycleways', () => {
    const facts = buildNetworkFacts([
      { highway: 'cycleway' },
      { highway: 'cycleway' },
    ]);
    const sep = facts.find(f => f.key === 'separated_cars');
    expect(sep).toBeDefined();
    expect(sep!.consistency).toBe('unanimous');
  });

  it('returns empty array for empty members', () => {
    expect(buildNetworkFacts([])).toEqual([]);
  });

  it('does not emit bicycle facts for networks (redundant on a bike site)', () => {
    const facts = buildNetworkFacts([
      { bicycle: 'designated' },
      { bicycle: 'designated' },
    ]);
    expect(facts.find(f => f.key === 'bicycle_designated')).toBeUndefined();
    expect(facts.find(f => f.key === 'bicycle_yes')).toBeUndefined();
  });

  it('returns all_parallel when all members have parallel_to', () => {
    const facts = buildNetworkFacts([
      { parallel_to: 'Bank Street' },
      { parallel_to: 'Main Street' },
    ]);
    const par = facts.find(f => f.key === 'all_parallel');
    expect(par).toBeDefined();
    expect(par!.consistency).toBe('unanimous');
  });

  it('returns some_parallel when some members have parallel_to', () => {
    const facts = buildNetworkFacts([
      { parallel_to: 'Bank Street' },
      {},
      {},
    ]);
    const par = facts.find(f => f.key === 'some_parallel');
    expect(par).toBeDefined();
    expect(par!.consistency).toBe('partial');
  });

  it('does not emit parallel fact when no members have parallel_to', () => {
    const facts = buildNetworkFacts([
      { surface: 'asphalt' },
      { surface: 'asphalt' },
    ]);
    expect(facts.find(f => f.key === 'some_parallel')).toBeUndefined();
    expect(facts.find(f => f.key === 'all_parallel')).toBeUndefined();
  });
});

describe('overlapping_relations', () => {
  it('are not emitted as facts (displayed in their own sidebar section)', () => {
    const facts = buildPathFacts({
      overlapping_relations: [
        { id: 123, name: 'Rideau Trail', route: 'hiking' },
        { id: 456, name: 'NCC Ski Trail', route: 'ski' },
      ],
    });
    expect(facts.find(f => f.key === 'overlapping_relation')).toBeUndefined();
  });
});

// ── Failing tests: issues to fix ─────────────────────────────────

describe('network fact suppression for non-cycling relations', () => {
  // Bill Holland Trail: OSM relation 8450027 is route=foot with network=lcn.
  // The pipeline copies network: lcn into bikepaths.yml, but the fact engine
  // should not display "Part of the local cycling network" for walking routes.
  // The route_type field (already in the YML schema) should be used to suppress.

  it('suppresses network_local when route_type is foot', () => {
    const facts = buildPathFacts({ network: 'lcn', route_type: 'foot' });
    expect(facts.find(f => f.key === 'network_local')).toBeUndefined();
  });

  it('suppresses network_regional when route_type is hiking', () => {
    const facts = buildPathFacts({ network: 'rcn', route_type: 'hiking' });
    expect(facts.find(f => f.key === 'network_regional')).toBeUndefined();
  });

  it('still emits network fact when route_type is absent (cycling-first entry)', () => {
    const facts = buildPathFacts({ network: 'lcn' });
    expect(facts.find(f => f.key === 'network_local')).toBeDefined();
  });

  it('still emits network fact when route_type is bicycle', () => {
    const facts = buildPathFacts({ network: 'rcn', route_type: 'bicycle' });
    expect(facts.find(f => f.key === 'network_regional')).toBeDefined();
  });
});

describe('family-friendly auto-detection from metadata', () => {
  // Beaverpond Park: asphalt, lit, 2m wide, good smoothness, MUP.
  // The app should automatically detect this as family-friendly
  // without requiring manual tags.

  it('emits family_friendly for a paved lit MUP with good surface', () => {
    const facts = buildPathFacts({
      path_type: 'mup',
      surface: 'asphalt',
      lit: 'yes',
      width: '2',
      smoothness: 'good',
    });
    expect(facts.find(f => f.key === 'family_friendly')).toBeDefined();
  });

  it('emits family_friendly for a concrete lit MUP with excellent smoothness', () => {
    const facts = buildPathFacts({
      path_type: 'mup',
      surface: 'concrete',
      lit: 'yes',
      width: '3',
      smoothness: 'excellent',
    });
    expect(facts.find(f => f.key === 'family_friendly')).toBeDefined();
  });

  it('does not emit family_friendly for MTB trails', () => {
    const facts = buildPathFacts({
      path_type: 'mtb-trail',
      surface: 'ground',
      mtb: true,
    });
    expect(facts.find(f => f.key === 'family_friendly')).toBeUndefined();
  });

  it('does not emit family_friendly for unlit paths', () => {
    const facts = buildPathFacts({
      path_type: 'mup',
      surface: 'asphalt',
      lit: 'no',
      width: '3',
      smoothness: 'good',
    });
    expect(facts.find(f => f.key === 'family_friendly')).toBeUndefined();
  });

  it('does not emit family_friendly for bike lanes (not separated from cars)', () => {
    const facts = buildPathFacts({
      path_type: 'bike-lane',
      surface: 'asphalt',
      lit: 'yes',
      width: '2',
      smoothness: 'good',
    });
    expect(facts.find(f => f.key === 'family_friendly')).toBeUndefined();
  });

  it('does not emit family_friendly for unpaved trails', () => {
    const facts = buildPathFacts({
      path_type: 'trail',
      surface: 'gravel',
      lit: 'yes',
      width: '2',
      smoothness: 'intermediate',
    });
    expect(facts.find(f => f.key === 'family_friendly')).toBeUndefined();
  });

  it('emits family_friendly for an unlit paved MUP in a park', () => {
    // Beaverpond Park: paved MUP in a park — safe for families even without lighting
    const facts = buildPathFacts({
      path_type: 'mup',
      surface: 'asphalt',
      lit: 'no',
      width: '2',
      smoothness: 'good',
      park: 'Beaverpond Park',
    });
    expect(facts.find(f => f.key === 'family_friendly')).toBeDefined();
  });

  it('does not emit family_friendly for unpaved park trails', () => {
    // Being in a park doesn't override the paved requirement
    const facts = buildPathFacts({
      path_type: 'trail',
      surface: 'ground',
      park: 'South March Highlands',
    });
    expect(facts.find(f => f.key === 'family_friendly')).toBeUndefined();
  });
});

describe('localizeFactValue — seasonal', () => {
  // Stub translator that returns the key with vars interpolated
  const t = (key: string, _locale?: string, vars?: Record<string, string | number>) => {
    const translations: Record<string, string> = {
      'paths.fact.seasonal_yes': 'Seasonal',
      'paths.fact.seasonal_winter': 'Winter only',
      'paths.fact.seasonal_only': '{season} only',
      'paths.fact.seasonal_closed': 'Closed in {seasons}',
      'paths.fact.season_spring': 'spring',
      'paths.fact.season_summer': 'summer',
      'paths.fact.season_autumn': 'autumn',
      'paths.fact.season_winter': 'winter',
    };
    let result = translations[key];
    if (result === undefined) return key; // unknown key → return key itself
    if (vars) {
      for (const [k, v] of Object.entries(vars)) result = result.replace(`{${k}}`, String(v));
    }
    return result;
  };

  it('yes → generic "Seasonal"', () => {
    expect(localizeFactValue({ key: 'seasonal', value: 'yes' }, t)).toBe('Seasonal');
  });

  it('winter → "Winter only" (direct key)', () => {
    expect(localizeFactValue({ key: 'seasonal', value: 'winter' }, t)).toBe('Winter only');
  });

  it('spring;summer;autumn → "Closed in winter"', () => {
    expect(localizeFactValue({ key: 'seasonal', value: 'spring;summer;autumn' }, t)).toBe('Closed in winter');
  });

  it('spring;summer → "Closed in autumn, winter"', () => {
    expect(localizeFactValue({ key: 'seasonal', value: 'spring;summer' }, t)).toBe('Closed in autumn, winter');
  });

  it('summer → "summer only" (fallback, no direct key for summer)', () => {
    // No paths.fact.seasonal_summer key → falls through to seasonal_only template
    expect(localizeFactValue({ key: 'seasonal', value: 'summer' }, t)).toBe('summer only');
  });

  it('all four seasons → generic "Seasonal"', () => {
    expect(localizeFactValue({ key: 'seasonal', value: 'spring;summer;autumn;winter' }, t)).toBe('Seasonal');
  });
});

describe('localizeFactValue — surface_mixed and lit_mixed', () => {
  const t = (key: string, _locale?: string) => {
    const map: Record<string, string> = {
      'paths.fact.paved': 'Paved',
      'paths.fact.gravel': 'Gravel',
      'paths.fact.dirt': 'Unpaved',
      'paths.fact.boardwalk': 'Boardwalk',
      'paths.fact.partially_lit': 'Some paths lit, some not',
    };
    return map[key] || key;
  };

  it('renders surface_mixed as localized breakdown with km', () => {
    const result = localizeFactValue(
      { key: 'surface_mixed', breakdown: [{ value: 'asphalt', km: 8 }, { value: 'gravel', km: 1 }] },
      t,
    );
    expect(result).toBe('Paved (8 km), Gravel (1 km)');
  });

  it('renders lit_mixed as partially_lit translation', () => {
    const result = localizeFactValue(
      { key: 'lit_mixed', breakdown: [{ value: 'yes', km: 6 }, { value: 'no', km: 3 }] },
      t,
    );
    expect(result).toBe('Some paths lit, some not');
  });

  it('surface_mixed uses displaySurface categories', () => {
    // fine_gravel → gravel category, wood → boardwalk category
    const result = localizeFactValue(
      { key: 'surface_mixed', breakdown: [{ value: 'fine_gravel', km: 5 }, { value: 'wood', km: 2 }] },
      t,
    );
    expect(result).toBe('Gravel (5 km), Boardwalk (2 km)');
  });

  it('factLabelKey maps surface_mixed to surface label', () => {
    expect(factLabelKey('surface_mixed')).toBe('paths.label.surface');
  });

  it('factLabelKey maps lit_mixed to lit label', () => {
    expect(factLabelKey('lit_mixed')).toBe('paths.label.lit');
  });
});

describe('localizeNetworkFactValue', () => {
  const t = (key: string) => {
    const map: Record<string, string> = {
      'paths.surface.asphalt': 'Paved',
      'paths.surface.fine_gravel': 'Gravel',
      'paths.fact.partially_lit': 'Partially lit',
    };
    return map[key] || key;
  };

  it('rounds km to whole numbers in surface_mixed breakdown', () => {
    const fact: NetworkFact = {
      key: 'surface_mixed',
      consistency: 'mixed',
      breakdown: [
        { value: 'asphalt', count: 5, km: 3.7 },
        { value: 'fine_gravel', count: 2, km: 1.2 },
      ],
    };
    const result = localizeNetworkFactValue(fact, t);
    expect(result).toContain('4 km');
    expect(result).toContain('1 km');
    expect(result).not.toMatch(/\d+\.\d+ km/);
  });

  it('drops breakdown entries that round to 0 km', () => {
    const fact: NetworkFact = {
      key: 'surface_mixed',
      consistency: 'mixed',
      breakdown: [
        { value: 'asphalt', count: 10, km: 5.2 },
        { value: 'wood', count: 1, km: 0.3 },
      ],
    };
    const result = localizeNetworkFactValue(fact, t);
    expect(result).toContain('5 km');
    expect(result).not.toContain('wood');
    expect(result).not.toContain('0 km');
  });
});

describe('surface + smoothness integration', () => {
  const t = (key: string) => {
    const keys: Record<string, string> = {
      'paths.fact.surface_adj_smooth': 'Smooth',
      'paths.fact.surface_adj_uneven': 'Uneven',
      'paths.fact.surface_adj_rough': 'Rough',
      'paths.fact.surface_adj_very_rough': 'Very rough',
      'paths.fact.surface_adj_extremely_rough': 'Extremely rough',
      'paths.fact.surface_adj_impassable': 'Impassable',
      'paths.fact.mup': 'Multi-use pathway',
      // displaySurface maps: asphalt→paved, fine_gravel→gravel, gravel→gravel, ground→dirt
      'paths.fact.paved': 'Pavement',
      'paths.fact.gravel': 'Gravel',
      'paths.fact.dirt': 'Dirt',
      'paths.fact.smoothness_bad': 'Rough — mountain bike recommended',
      'paths.fact.smoothness_intermediate': 'Uneven surface — hybrid or wider tyres',
      'paths.label.surface': 'Surface',
      'paths.label.surface_quality': 'Surface quality',
    };
    return keys[key] || key;
  };

  it('excellent on paved → "Smooth pavement"', () => {
    const facts = buildPathFacts({ path_type: 'mup', surface: 'asphalt', smoothness: 'excellent' } as any);
    const surfaceFact = facts.find(f => f.key === 'surface');
    expect(surfaceFact).toBeDefined();
    expect(surfaceFact!.breakdown?.[0]?.value).toBe('smooth');
    const rendered = localizeFactValue(surfaceFact!, t);
    expect(rendered).toBe('Smooth pavement');
  });

  it('excellent on unpaved → no adjective (just surface name)', () => {
    const facts = buildPathFacts({ path_type: 'trail', surface: 'fine_gravel', smoothness: 'excellent' } as any);
    const surfaceFact = facts.find(f => f.key === 'surface');
    expect(surfaceFact).toBeDefined();
    expect(surfaceFact!.breakdown).toBeUndefined();
    const rendered = localizeFactValue(surfaceFact!, t);
    expect(rendered).toBe('Gravel');
  });

  it('good → dropped entirely (no smoothness shown)', () => {
    const facts = buildPathFacts({ path_type: 'mup', surface: 'asphalt', smoothness: 'good' } as any);
    const surfaceFact = facts.find(f => f.key === 'surface');
    expect(surfaceFact!.breakdown).toBeUndefined();
    const smoothnessFact = facts.find(f => f.key.startsWith('smoothness_'));
    expect(smoothnessFact).toBeUndefined();
  });

  it('intermediate → "Uneven pavement"', () => {
    const facts = buildPathFacts({ path_type: 'mup', surface: 'asphalt', smoothness: 'intermediate' } as any);
    const surfaceFact = facts.find(f => f.key === 'surface');
    expect(surfaceFact!.breakdown?.[0]?.value).toBe('uneven');
    const rendered = localizeFactValue(surfaceFact!, t);
    expect(rendered).toBe('Uneven pavement');
  });

  it('bad on gravel → "Rough gravel"', () => {
    const facts = buildPathFacts({ path_type: 'trail', surface: 'gravel', smoothness: 'bad' } as any);
    const surfaceFact = facts.find(f => f.key === 'surface');
    expect(surfaceFact!.breakdown?.[0]?.value).toBe('rough');
    const rendered = localizeFactValue(surfaceFact!, t);
    expect(rendered).toBe('Rough gravel');
  });

  it('mixed surface + bad smoothness → separate warning row', () => {
    const mix = [{ value: 'asphalt', km: 10 }, { value: 'gravel', km: 7 }];
    const facts = buildPathFacts({ path_type: 'mup', surface: 'asphalt', smoothness: 'bad', surface_mix: mix } as any);
    const mixFact = facts.find(f => f.key === 'surface_mixed');
    expect(mixFact).toBeDefined();
    const smoothnessFact = facts.find(f => f.key === 'smoothness_bad');
    expect(smoothnessFact).toBeDefined();
  });

  it('mixed surface + good smoothness → no smoothness shown', () => {
    const mix = [{ value: 'asphalt', km: 10 }, { value: 'gravel', km: 7 }];
    const facts = buildPathFacts({ path_type: 'mup', surface: 'asphalt', smoothness: 'good', surface_mix: mix } as any);
    const smoothnessFact = facts.find(f => f.key.startsWith('smoothness_'));
    expect(smoothnessFact).toBeUndefined();
  });

  it('no surface but bad smoothness → standalone warning', () => {
    const facts = buildPathFacts({ smoothness: 'bad' } as any);
    const smoothnessFact = facts.find(f => f.key === 'smoothness_bad');
    expect(smoothnessFact).toBeDefined();
  });

  it('no smoothness → plain surface, no adjective', () => {
    const facts = buildPathFacts({ path_type: 'mup', surface: 'asphalt' } as any);
    const surfaceFact = facts.find(f => f.key === 'surface');
    expect(surfaceFact!.breakdown).toBeUndefined();
    const rendered = localizeFactValue(surfaceFact!, t);
    expect(rendered).toBe('Pavement');
  });
});

describe('facts table ordering', () => {
  it('family_friendly appears before surface', () => {
    const facts = buildPathFacts({
      path_type: 'mup', surface: 'asphalt', smoothness: 'good',
      lit: 'yes', park: 'Test Park',
    } as any);
    const familyIdx = facts.findIndex(f => f.key === 'family_friendly');
    const surfaceIdx = facts.findIndex(f => f.key === 'surface');
    expect(familyIdx).toBeGreaterThan(-1);
    expect(surfaceIdx).toBeGreaterThan(-1);
    expect(familyIdx).toBeLessThan(surfaceIdx);
  });

  it('path_info is always first', () => {
    const facts = buildPathFacts({ path_type: 'mup', surface: 'asphalt' } as any);
    expect(facts[0].key).toBe('path_info');
  });

  it('route ref is not emitted', () => {
    const facts = buildPathFacts({ path_type: 'mup', surface: 'asphalt', ref: 'GPW' } as any);
    const refFact = facts.find(f => f.key === 'ref');
    expect(refFact).toBeUndefined();
  });
});

describe('path_info excludes surface, shows width as "wide"', () => {
  it('does not include surface in path_info value', () => {
    const facts = buildPathFacts({ path_type: 'mup', surface: 'asphalt', width: '3' } as any);
    const pathInfo = facts.find(f => f.key === 'path_info');
    // Format: "mup::3" — surface slot is empty
    expect(pathInfo!.value).toBe('mup::3');
  });

  it('renders width as "3m wide"', () => {
    const wideT = (key: string) => {
      const keys: Record<string, string> = {
        'paths.fact.mup': 'Multi-use pathway',
        'paths.fact.wide': 'wide',
      };
      return keys[key] || key;
    };
    const facts = buildPathFacts({ path_type: 'mup', width: '3' } as any);
    const pathInfo = facts.find(f => f.key === 'path_info');
    const rendered = localizeFactValue(pathInfo!, wideT);
    expect(rendered).toContain('3m wide');
  });
});
