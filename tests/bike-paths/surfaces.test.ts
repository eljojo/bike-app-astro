import { describe, it, expect } from 'vitest';
import {
  SURFACE_CATEGORIES,
  UNPAVED,
  isUnpaved,
  isPaved,
  displaySurface,
} from '../../src/lib/bike-paths/surfaces';

describe('SURFACE_CATEGORIES', () => {
  it('maps asphalt to paved', () => {
    expect(SURFACE_CATEGORIES['asphalt']).toBe('paved');
  });
  it('maps concrete to paved', () => {
    expect(SURFACE_CATEGORIES['concrete']).toBe('paved');
  });
  it('maps paving_stones to paved', () => {
    expect(SURFACE_CATEGORIES['paving_stones']).toBe('paved');
  });
  it('maps fine_gravel to gravel', () => {
    expect(SURFACE_CATEGORIES['fine_gravel']).toBe('gravel');
  });
  it('maps compacted to gravel', () => {
    expect(SURFACE_CATEGORIES['compacted']).toBe('gravel');
  });
  it('maps ground to dirt', () => {
    expect(SURFACE_CATEGORIES['ground']).toBe('dirt');
  });
  it('maps wood to boardwalk', () => {
    expect(SURFACE_CATEGORIES['wood']).toBe('boardwalk');
  });
  it('maps unpaved to dirt', () => {
    expect(SURFACE_CATEGORIES['unpaved']).toBe('dirt');
  });
  it('maps dirt/sand to dirt', () => {
    expect(SURFACE_CATEGORIES['dirt/sand']).toBe('dirt');
  });
  it('returns undefined for unknown surfaces', () => {
    expect(SURFACE_CATEGORIES['cobblestone']).toBeUndefined();
  });
  it('has exactly 17 entries', () => {
    expect(Object.keys(SURFACE_CATEGORIES).length).toBe(17);
  });
});

describe('UNPAVED', () => {
  it('contains ground', () => {
    expect(UNPAVED.has('ground')).toBe(true);
  });
  it('contains gravel', () => {
    expect(UNPAVED.has('gravel')).toBe(true);
  });
  it('does NOT contain wood (boardwalks are rideable)', () => {
    expect(UNPAVED.has('wood')).toBe(false);
  });
  it('does NOT contain asphalt', () => {
    expect(UNPAVED.has('asphalt')).toBe(false);
  });
  it('contains unpaved', () => {
    expect(UNPAVED.has('unpaved')).toBe(true);
  });
  it('contains dirt/sand', () => {
    expect(UNPAVED.has('dirt/sand')).toBe(true);
  });
  it('contains exactly 12 entries', () => {
    expect(UNPAVED.size).toBe(12);
  });
});

describe('isUnpaved', () => {
  it('ground is unpaved', () => {
    expect(isUnpaved('ground')).toBe(true);
  });
  it('asphalt is not unpaved', () => {
    expect(isUnpaved('asphalt')).toBe(false);
  });
  it('undefined is not unpaved', () => {
    expect(isUnpaved(undefined)).toBe(false);
  });
  it('unknown surface is not unpaved', () => {
    expect(isUnpaved('cobblestone')).toBe(false);
  });
  it('wood is not unpaved', () => {
    expect(isUnpaved('wood')).toBe(false);
  });
});

describe('isPaved', () => {
  it('asphalt is paved', () => {
    expect(isPaved('asphalt')).toBe(true);
  });
  it('ground is not paved', () => {
    expect(isPaved('ground')).toBe(false);
  });
  it('undefined is not paved (unknown)', () => {
    expect(isPaved(undefined)).toBe(false);
  });
  it('wood is paved (boardwalks are rideable)', () => {
    expect(isPaved('wood')).toBe(true);
  });
  it('unknown surface is treated as paved (matches existing pipeline behavior)', () => {
    expect(isPaved('cobblestone')).toBe(true);
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
