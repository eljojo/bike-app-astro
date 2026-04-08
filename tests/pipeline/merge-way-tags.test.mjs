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

  it('sorts surface_mix by km descending', () => {
    const result = mergeWayTags([
      { tags: { surface: 'gravel' }, geometry: [[0,45],[0.05,45]] },
      { tags: { surface: 'asphalt' }, geometry: [[0.05,45],[0.06,45]] },
    ]);
    if (result.surface_mix) {
      expect(result.surface_mix[0].km).toBeGreaterThanOrEqual(result.surface_mix[1].km);
    }
  });
});
