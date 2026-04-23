import { describe, it, expect } from 'vitest';
import { groupWaysIntoSegments, type WayInput } from '../../../src/lib/bike-paths/segments';

// Geometry helper — the default way() line is ~0.78km at ~45°N (a
// 0.01° east-west step). Pinned assertions in the tests below use
// the 1dp-rounded value derived from that default.
function line(...pts: Array<[number, number]>): [number, number][] {
  return pts;
}

function way(overrides: Partial<WayInput>): WayInput {
  return {
    name: undefined,
    surface: undefined,
    lines: [line([-75.70, 45.40], [-75.69, 45.40])], // ~0.78km east-west
    ...overrides,
  };
}

describe('groupWaysIntoSegments', () => {
  it('returns an empty array for empty input', () => {
    expect(groupWaysIntoSegments([])).toEqual([]);
  });

  it('returns one segment for one unnamed way', () => {
    const segments = groupWaysIntoSegments([way({ surface: 'asphalt' })]);
    expect(segments).toHaveLength(1);
    expect(segments[0].name).toBeUndefined();
    expect(segments[0].surface_mix).toHaveLength(1);
    expect(segments[0].surface_mix[0].value).toBe('asphalt');
    expect(segments[0].surface_mix[0].km).toBe(0.8); // ~0.78km rounded to 1dp
  });

  it('returns one segment for one named way', () => {
    const segments = groupWaysIntoSegments([
      way({ name: 'Path #15', surface: 'asphalt' }),
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0].name).toBe('Path #15');
  });

  it('collapses multiple same-name, same-surface ways into one segment', () => {
    const segments = groupWaysIntoSegments([
      way({ name: 'Path #15', surface: 'asphalt' }),
      way({ name: 'Path #15', surface: 'asphalt' }),
      way({ name: 'Path #15', surface: 'asphalt' }),
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0].name).toBe('Path #15');
    expect(segments[0].surface_mix).toHaveLength(1);
    expect(segments[0].surface_mix[0].value).toBe('asphalt');
    // 3 ways each ~0.78km, summed then rounded to 1dp
    expect(segments[0].surface_mix[0].km).toBe(2.3);
  });

  it('produces one segment with multi-surface mix for a mixed-surface named path', () => {
    const segments = groupWaysIntoSegments([
      way({ name: 'Path #15', surface: 'asphalt' }),
      way({ name: 'Path #15', surface: 'asphalt' }),
      way({ name: 'Path #15', surface: 'gravel' }),
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0].name).toBe('Path #15');
    expect(segments[0].surface_mix).toHaveLength(2);
    // surface_mix is sorted descending by km — asphalt should be first (two ways)
    expect(segments[0].surface_mix[0].value).toBe('asphalt');
    expect(segments[0].surface_mix[1].value).toBe('gravel');
  });

  it('returns one segment per distinct name', () => {
    const segments = groupWaysIntoSegments([
      way({ name: 'Path #15', surface: 'asphalt' }),
      way({ name: 'Chemin Kingsmere', surface: 'asphalt' }),
      way({ name: 'Chemin Swamp', surface: 'asphalt' }),
    ]);
    expect(segments).toHaveLength(3);
    const names = segments.map(s => s.name).sort();
    expect(names).toEqual(['Chemin Kingsmere', 'Chemin Swamp', 'Path #15']);
  });

  it('collapses same-named ways in two physically separate areas into one segment', () => {
    // Same name, disconnected geometry — by design we do not track
    // graph connectivity; they collapse into one segment with their
    // combined length.
    const segments = groupWaysIntoSegments([
      way({ name: 'Chemin Kingsmere', surface: 'asphalt', lines: [line([-75.90, 45.40], [-75.89, 45.40])] }),
      way({ name: 'Chemin Kingsmere', surface: 'asphalt', lines: [line([-75.50, 45.60], [-75.49, 45.60])] }),
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0].name).toBe('Chemin Kingsmere');
  });

  it('collapses all unnamed ways into a single {name: undefined} segment', () => {
    const segments = groupWaysIntoSegments([
      way({ surface: 'asphalt' }),
      way({ surface: 'asphalt' }),
      way({ surface: 'gravel' }),
    ]);
    const unnamed = segments.filter(s => s.name === undefined);
    expect(unnamed).toHaveLength(1);
    expect(unnamed[0].surface_mix).toHaveLength(2);
  });

  it('handles a mix of named and unnamed ways', () => {
    const segments = groupWaysIntoSegments([
      way({ name: 'Path #15', surface: 'asphalt' }),
      way({ surface: 'asphalt' }),
      way({ name: 'Path #15', surface: 'gravel' }),
      way({ surface: 'gravel' }),
    ]);
    expect(segments).toHaveLength(2);
    const named = segments.find(s => s.name === 'Path #15');
    const unnamed = segments.find(s => s.name === undefined);
    expect(named).toBeDefined();
    expect(unnamed).toBeDefined();
    expect(named!.surface_mix).toHaveLength(2);
    expect(unnamed!.surface_mix).toHaveLength(2);
  });

  it('returns a `ways` field on each segment with the underlying way inputs', () => {
    // The caller (mergeFeatures) needs access to the per-way data to
    // distribute lines across surface-category features.
    const w1 = way({ name: 'Path #15', surface: 'asphalt' });
    const w2 = way({ name: 'Path #15', surface: 'gravel' });
    const segments = groupWaysIntoSegments([w1, w2]);
    expect(segments).toHaveLength(1);
    expect(segments[0].ways).toHaveLength(2);
    expect(segments[0].ways).toContain(w1);
    expect(segments[0].ways).toContain(w2);
  });

  it('rounds surface_mix km to one decimal place', () => {
    // Default way() geometry is a 0.01° east-west step at 45.40°N.
    // Raw haversine is ~0.78 km; rounded to one decimal place this is 0.8.
    // If the rounding rule ever changes (integer km, 2dp, no rounding),
    // this assertion will fail and the change will surface at review.
    const segments = groupWaysIntoSegments([way({ name: 'X', surface: 'asphalt' })]);
    expect(segments[0].surface_mix[0].km).toBe(0.8);
  });

  it('uses the literal string "unknown" for ways with no surface tag', () => {
    const segments = groupWaysIntoSegments([way({ name: 'X', surface: undefined })]);
    expect(segments[0].surface_mix[0].value).toBe('unknown');
  });
});
