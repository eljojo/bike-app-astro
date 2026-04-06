import { describe, it, expect } from 'vitest';
import {
  NETWORK_LABELS,
  computeCenter,
  buildPathFacts,
  buildNetworkFacts,
  findNearestMajorPath,
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

  // --- path_info: combined path_type + surface + width ---

  it('combines path_type + surface + width into single path_info fact', () => {
    const facts = buildPathFacts({ path_type: 'mup', surface: 'asphalt', width: '3' });
    expect(facts[0]).toEqual({ key: 'path_info', value: 'mup:asphalt:3' });
  });

  it('path_info with path_type + surface, no width', () => {
    const facts = buildPathFacts({ path_type: 'mtb-trail', surface: 'ground' });
    expect(facts[0]).toEqual({ key: 'path_info', value: 'mtb-trail:ground:' });
  });

  it('path_info with path_type only', () => {
    const facts = buildPathFacts({ path_type: 'bike-lane' });
    expect(facts[0]).toEqual({ key: 'path_info', value: 'bike-lane::' });
  });

  it('path_info with surface only (no path_type)', () => {
    const facts = buildPathFacts({ surface: 'gravel' });
    expect(facts[0]).toEqual({ key: 'path_info', value: ':gravel:' });
  });

  it('path_info with surface + width, no path_type', () => {
    const facts = buildPathFacts({ surface: 'asphalt', width: '2.5' });
    expect(facts[0]).toEqual({ key: 'path_info', value: ':asphalt:2.5' });
  });

  it('path_info with width only', () => {
    const facts = buildPathFacts({ width: '3' });
    expect(facts[0]).toEqual({ key: 'path_info', value: '::3' });
  });

  it('path_info passes through unknown surface values', () => {
    const facts = buildPathFacts({ surface: 'cobblestone' });
    expect(facts[0]).toEqual({ key: 'path_info', value: ':cobblestone:' });
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
    expect(facts[0]).toEqual({ key: 'path_info', value: 'bike-lane:asphalt:' });
  });

  it('path_info strips tiny widths (<0.3m not a real path)', () => {
    const facts = buildPathFacts({ surface: 'asphalt', width: '0.1' });
    expect(facts[0]).toEqual({ key: 'path_info', value: ':asphalt:' });
  });

  it('path_info strips unparseable widths', () => {
    const facts = buildPathFacts({ surface: 'ground', width: '1 mm' });
    expect(facts[0]).toEqual({ key: 'path_info', value: ':ground:' });
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

  it('emits smoothness', () => {
    expect(buildPathFacts({ smoothness: 'good' })).toContainEqual({ key: 'smoothness_good' });
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

  it('emits seasonal, ref, inception', () => {
    expect(buildPathFacts({ seasonal: 'winter' })).toContainEqual({ key: 'seasonal', value: 'winter' });
    expect(buildPathFacts({ ref: 'RV1' })).toContainEqual({ key: 'ref', value: 'RV1' });
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
      'path_info',
      'smoothness_good',
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
      { surface: 'asphalt' },
      { surface: 'fine_gravel' },
      { surface: 'asphalt' },
    ]);
    const surface = facts.find(f => f.key === 'surface_mixed');
    expect(surface).toBeDefined();
    expect(surface!.consistency).toBe('mixed');
    expect(surface!.breakdown).toHaveLength(2);
    // Paved should come first (count 2 > count 1)
    expect(surface!.breakdown![0]).toEqual({ value: 'paved', count: 2 });
    expect(surface!.breakdown![1]).toEqual({ value: 'gravel', count: 1 });
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

  it('returns mixed path_type when members have different types', () => {
    const facts = buildNetworkFacts([
      { path_type: 'mup' },
      { path_type: 'mup' },
      { path_type: 'bike-lane' },
      { path_type: 'trail' },
    ]);
    const pt = facts.find(f => f.key === 'path_type_mixed');
    expect(pt).toBeDefined();
    expect(pt!.consistency).toBe('mixed');
    expect(pt!.breakdown).toHaveLength(3);
    expect(pt!.breakdown![0]).toEqual({ value: 'mup', count: 2 });
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
