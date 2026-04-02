import { describe, it, expect } from 'vitest';
import {
  SURFACE_CATEGORIES,
  displaySurface,
  NETWORK_LABELS,
  computeCenter,
  buildPathFacts,
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
    expect(facts).toContainEqual({ key: 'surface_width', value: 'paved:3' });
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
      'separated_cars',
      'separated_peds',
      'lit',
      'flat',
      'operator',
      'network_national',
    ]);
  });
});
