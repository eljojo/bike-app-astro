import { describe, it, expect } from 'vitest';
import {
  SURFACE_CATEGORIES,
  displaySurface,
  NETWORK_LABELS,
  computeCenter,
  buildPathFacts,
  buildNetworkFacts,
  findNearestMajorPath,
} from '../src/lib/bike-paths/bike-path-facts';

describe('SURFACE_CATEGORIES', () => {
  it('maps asphalt to paved', () => {
    expect(SURFACE_CATEGORIES['asphalt']).toBe('paved');
  });

  it('maps concrete to paved', () => {
    expect(SURFACE_CATEGORIES['concrete']).toBe('paved');
  });

  it('maps fine_gravel to gravel', () => {
    expect(SURFACE_CATEGORIES['fine_gravel']).toBe('gravel');
  });

  it('maps gravel to gravel', () => {
    expect(SURFACE_CATEGORIES['gravel']).toBe('gravel');
  });

  it('maps compacted to gravel', () => {
    expect(SURFACE_CATEGORIES['compacted']).toBe('gravel');
  });

  it('maps ground to dirt', () => {
    expect(SURFACE_CATEGORIES['ground']).toBe('dirt');
  });

  it('maps dirt to dirt', () => {
    expect(SURFACE_CATEGORIES['dirt']).toBe('dirt');
  });

  it('returns undefined for unknown surfaces', () => {
    expect(SURFACE_CATEGORIES['wood']).toBeUndefined();
  });
});

describe('displaySurface', () => {
  it('returns category key for known surface', () => {
    expect(displaySurface('asphalt')).toBe('paved');
  });

  it('returns raw value for unknown surface', () => {
    expect(displaySurface('cobblestone')).toBe('cobblestone');
  });

  it('returns undefined for undefined input', () => {
    expect(displaySurface(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(displaySurface('')).toBeUndefined();
  });
});

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

  it('emits surface_width when both surface and width present', () => {
    const facts = buildPathFacts({ surface: 'asphalt', width: '3' });
    expect(facts).toContainEqual({ key: 'surface_width', value: 'asphalt:3' });
  });

  it('emits surface alone when no width', () => {
    const facts = buildPathFacts({ surface: 'gravel' });
    expect(facts).toContainEqual({ key: 'surface', value: 'gravel' });
  });

  it('emits width alone when no surface', () => {
    const facts = buildPathFacts({ width: '2.5' });
    expect(facts).toContainEqual({ key: 'width', value: '2.5' });
  });

  it('uses raw surface value for unknown surfaces', () => {
    const facts = buildPathFacts({ surface: 'cobblestone' });
    expect(facts).toContainEqual({ key: 'surface', value: 'cobblestone' });
  });

  it('emits smoothness fact for known values', () => {
    const facts = buildPathFacts({ smoothness: 'good' });
    expect(facts).toContainEqual({ key: 'smoothness_good' });
  });

  it('emits smoothness fact for rough values', () => {
    const facts = buildPathFacts({ smoothness: 'very_bad' });
    expect(facts).toContainEqual({ key: 'smoothness_very_bad' });
  });

  it('does not emit smoothness when undefined', () => {
    const facts = buildPathFacts({ surface: 'asphalt' });
    const keys = facts.map(f => f.key);
    expect(keys.some(k => k.startsWith('smoothness_'))).toBe(false);
  });

  it('emits separated_cars for cycleway', () => {
    const facts = buildPathFacts({ highway: 'cycleway' });
    expect(facts).toContainEqual({ key: 'separated_cars' });
  });

  it('does not emit separated_cars for non-cycleway', () => {
    const facts = buildPathFacts({ highway: 'path' });
    const keys = facts.map(f => f.key);
    expect(keys).not.toContain('separated_cars');
  });

  it('emits separated_peds when segregated=yes', () => {
    const facts = buildPathFacts({ segregated: 'yes' });
    expect(facts).toContainEqual({ key: 'separated_peds' });
  });

  it('does not emit separated_peds when segregated=no', () => {
    const facts = buildPathFacts({ segregated: 'no' });
    const keys = facts.map(f => f.key);
    expect(keys).not.toContain('separated_peds');
  });

  it('emits lit when lit=yes', () => {
    const facts = buildPathFacts({ lit: 'yes' });
    expect(facts).toContainEqual({ key: 'lit' });
  });

  it('emits not_lit when lit=no', () => {
    const facts = buildPathFacts({ lit: 'no' });
    expect(facts).toContainEqual({ key: 'not_lit' });
  });

  it('emits flat for elevation < 20', () => {
    const facts = buildPathFacts({ elevation_gain_m: 10 });
    expect(facts).toContainEqual({ key: 'flat' });
  });

  it('emits gentle_hills for elevation 20-79', () => {
    const facts = buildPathFacts({ elevation_gain_m: 50 });
    expect(facts).toContainEqual({ key: 'gentle_hills', value: '50' });
  });

  it('emits hilly for elevation >= 80', () => {
    const facts = buildPathFacts({ elevation_gain_m: 120 });
    expect(facts).toContainEqual({ key: 'hilly', value: '120' });
  });

  it('emits operator with name as value', () => {
    const facts = buildPathFacts({ operator: 'NCC' });
    expect(facts).toContainEqual({ key: 'operator', value: 'NCC' });
  });

  it('emits network label for known network code', () => {
    const facts = buildPathFacts({ network: 'rcn' });
    expect(facts).toContainEqual({ key: 'network_regional' });
  });

  it('does not emit network fact for unknown network code', () => {
    const facts = buildPathFacts({ network: 'unknown' });
    const keys = facts.map(f => f.key);
    expect(keys).not.toContain('network_regional');
    expect(keys).not.toContain('network_national');
    expect(keys).not.toContain('network_local');
  });

  it('builds full fact list for a rich path', () => {
    const facts = buildPathFacts({
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
      'surface_width',
      'smoothness_good',
      'separated_cars',
      'separated_peds',
      'lit',
      'flat',
      'operator',
      'network_national',
    ]);
  });

  it('no longer emits mtb fact (replaced by path_type)', () => {
    const facts = buildPathFacts({ mtb: true });
    expect(facts.map(f => f.key)).not.toContain('mtb');
  });

  it('emits path_type as first fact', () => {
    const facts = buildPathFacts({ path_type: 'mup', surface: 'asphalt' });
    expect(facts[0]).toEqual({ key: 'path_type', value: 'mup' });
  });

  it.each([
    'mup', 'separated-lane', 'bike-lane', 'paved-shoulder', 'mtb-trail', 'trail',
  ] as const)('emits path_type fact for %s', (type) => {
    const facts = buildPathFacts({ path_type: type });
    expect(facts).toContainEqual({ key: 'path_type', value: type });
  });

  it('does not emit path_type when undefined', () => {
    const facts = buildPathFacts({ surface: 'asphalt' });
    expect(facts.map(f => f.key)).not.toContain('path_type');
  });

  it('emits seasonal fact when seasonal is set', () => {
    const facts = buildPathFacts({ seasonal: 'winter' });
    expect(facts).toContainEqual({ key: 'seasonal', value: 'winter' });
  });

  it('emits ref fact when ref is set', () => {
    const facts = buildPathFacts({ ref: 'RV1' });
    expect(facts).toContainEqual({ key: 'ref', value: 'RV1' });
  });

  it('emits inception fact when inception is set', () => {
    const facts = buildPathFacts({ inception: '1970s' });
    expect(facts).toContainEqual({ key: 'inception', value: '1970s' });
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
});
