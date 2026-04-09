import { describe, it, expect } from 'vitest';
import { mergeWayTags } from '../../scripts/pipeline/build-bikepaths.ts';

describe('mergeWayTags', () => {
  it('returns dominant surface when all ways agree', () => {
    const result = mergeWayTags([
      { tags: { surface: 'asphalt' }, geometry: [[0,0],[0,0.01]] },
      { tags: { surface: 'asphalt' }, geometry: [[0,0.01],[0,0.02]] },
    ]);
    expect(result.surface).toBe('asphalt');
    expect(result.surface_mix).toBeUndefined();
  });

  it('produces surface_mix when ways disagree', () => {
    const result = mergeWayTags([
      { tags: { surface: 'asphalt' }, geometry: [[0,45],[0.01,45]] },
      { tags: { surface: 'gravel' }, geometry: [[0.01,45],[0.02,45]] },
    ]);
    expect(result.surface).toBeDefined();
    expect(result.surface_mix).toBeDefined();
    expect(result.surface_mix.length).toBe(2);
    expect(result.surface_mix.every(m => typeof m.value === 'string' && typeof m.km === 'number')).toBe(true);
  });

  it('drops surface_mix values that round to 0 km', () => {
    const result = mergeWayTags([
      { tags: { surface: 'asphalt' }, geometry: [[0,45],[0.1,45]] },
      { tags: { surface: 'wood' }, geometry: [[0.1,45],[0.1001,45]] },
    ]);
    if (result.surface_mix) {
      for (const m of result.surface_mix) {
        expect(m.km).toBeGreaterThan(0);
      }
    }
  });

  it('produces lit_mix when ways disagree on lit', () => {
    const result = mergeWayTags([
      { tags: { lit: 'yes' }, geometry: [[0,45],[0.01,45]] },
      { tags: { lit: 'no' }, geometry: [[0.01,45],[0.02,45]] },
    ]);
    expect(result.lit_mix).toBeDefined();
    expect(result.lit_mix.some(m => m.value === 'yes')).toBe(true);
    expect(result.lit_mix.some(m => m.value === 'no')).toBe(true);
  });

  it('no lit_mix when all ways agree', () => {
    const result = mergeWayTags([
      { tags: { lit: 'yes' }, geometry: [[0,45],[0.01,45]] },
      { tags: { lit: 'yes' }, geometry: [[0.01,45],[0.02,45]] },
    ]);
    expect(result.lit_mix).toBeUndefined();
  });

  it('no lit_mix when only one side is tagged (absence != no)', () => {
    const result = mergeWayTags([
      { tags: { lit: 'yes' }, geometry: [[0,45],[0.01,45]] },
      { tags: {}, geometry: [[0.01,45],[0.02,45]] },
    ]);
    expect(result.lit_mix).toBeUndefined();
  });

  it('falls back to way count when geometry is unavailable', () => {
    const result = mergeWayTags([
      { tags: { surface: 'asphalt' } },
      { tags: { surface: 'asphalt' } },
      { tags: { surface: 'gravel' } },
    ]);
    expect(result.surface_mix).toBeDefined();
    expect(result.surface_mix.every(m => typeof m.km === 'number')).toBe(true);
  });

  it('picks majority by distance, not way count', () => {
    // 2 short gravel ways vs 1 long asphalt way — asphalt should win by distance
    const result = mergeWayTags([
      { tags: { surface: 'gravel' }, geometry: [[0,45],[0.001,45]] },
      { tags: { surface: 'gravel' }, geometry: [[0.001,45],[0.002,45]] },
      { tags: { surface: 'asphalt' }, geometry: [[0.002,45],[0.1,45]] },
    ]);
    expect(result.surface).toBe('asphalt');
  });

  it('sorts surface_mix by km descending', () => {
    const result = mergeWayTags([
      { tags: { surface: 'gravel' }, geometry: [[0,45],[0.05,45]] },
      { tags: { surface: 'asphalt' }, geometry: [[0.05,45],[0.06,45]] },
    ]);
    if (result.surface_mix) {
      expect(result.surface_mix[0].km).toBeGreaterThanOrEqual(result.surface_mix[1].km);
    }
  });

  // --- Per-segment tags require majority-km coverage to propagate ---

  it('drops minority piste:type that covers <50% of entry length (Dewberry Trail)', () => {
    // Real case: 3 ways of roughly equal length, only 1 has piste:type=nordic.
    // The tag describes that segment, not the whole trail. Propagating it
    // would make the entry look ski-only.
    const result = mergeWayTags([
      { tags: { highway: 'path', foot: 'yes' }, geometry: [[0,45],[0.01,45]] },
      { tags: { highway: 'path', foot: 'yes', ski: 'yes' }, geometry: [[0.01,45],[0.02,45]] },
      { tags: { highway: 'path', 'piste:type': 'nordic' }, geometry: [[0.02,45],[0.03,45]] },
    ]);
    expect(result['piste:type'], 'minority piste:type must be dropped').toBeUndefined();
    expect(result.ski, 'minority ski=yes must be dropped').toBeUndefined();
    expect(result.foot, 'majority foot=yes must be kept').toBe('yes');
    expect(result.highway, 'unanimous highway=path must be kept').toBe('path');
  });

  it('keeps majority piste:type that covers ≥50% of entry length', () => {
    // 3 ways, 2 with piste:type=nordic → 67% of entry length.
    const result = mergeWayTags([
      { tags: { highway: 'path', 'piste:type': 'nordic' }, geometry: [[0,45],[0.01,45]] },
      { tags: { highway: 'path', 'piste:type': 'nordic' }, geometry: [[0.01,45],[0.02,45]] },
      { tags: { highway: 'path' }, geometry: [[0.02,45],[0.03,45]] },
    ]);
    expect(result['piste:type'], 'majority piste:type must be kept').toBe('nordic');
  });

  it('drops minority tunnel=yes (single tunneled segment)', () => {
    // A 1km tunnel in a 10km path should not make the entry tunnel=yes.
    const result = mergeWayTags([
      { tags: { highway: 'cycleway', tunnel: 'yes' }, geometry: [[0,45],[0.01,45]] }, // ~1km
      { tags: { highway: 'cycleway' }, geometry: [[0.01,45],[0.1,45]] }, // ~9km
    ]);
    expect(result.tunnel, 'minority tunnel must be dropped').toBeUndefined();
    expect(result.highway).toBe('cycleway');
  });

  it('drops minority bridge=yes and railway=abandoned', () => {
    const result = mergeWayTags([
      { tags: { highway: 'path', bridge: 'yes' }, geometry: [[0,45],[0.005,45]] }, // short
      { tags: { highway: 'path', 'abandoned:railway': 'rail' }, geometry: [[0.005,45],[0.01,45]] },
      { tags: { highway: 'path' }, geometry: [[0.01,45],[0.1,45]] }, // long
    ]);
    expect(result.bridge).toBeUndefined();
    expect(result['abandoned:railway']).toBeUndefined();
  });

  it('keeps majority bicycle tag even when some ways lack it (access tags exempt)', () => {
    // Access tags (bicycle, foot) are not per-segment in the problematic
    // sense — they're access semantics. The existing majority-by-tagged-km
    // rule applies: any propagation on presence is OK here.
    const result = mergeWayTags([
      { tags: { highway: 'path', bicycle: 'designated' }, geometry: [[0,45],[0.01,45]] },
      { tags: { highway: 'path' }, geometry: [[0.01,45],[0.05,45]] },
    ]);
    expect(result.bicycle, 'access tags are not in PER_SEGMENT_TAGS').toBe('designated');
  });

  it('keeps majority surface even though it is not in the per-segment set', () => {
    // Physical tags like surface already use the loss-warning system; they
    // are intentionally NOT in PER_SEGMENT_TAGS and should still propagate.
    // Use km-scale values so surface_mix rounding doesn't drop minorities.
    const result = mergeWayTags([
      { tags: { surface: 'asphalt' }, geometry: [[0,45],[0.02,45]] },
      { tags: { surface: 'gravel' }, geometry: [[0.02,45],[0.035,45]] },
    ]);
    expect(result.surface).toBe('asphalt');
    expect(result.surface_mix).toBeDefined();
  });
});
