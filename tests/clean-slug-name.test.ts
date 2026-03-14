import { describe, it, expect } from 'vitest';
import { cleanSlugName } from '../src/lib/clean-slug-name';

describe('cleanSlugName', () => {
  it('strips leading dash', () => {
    expect(cleanSlugName('-wandering')).toBe('wandering');
  });

  it('strips leading dash with hex hash suffix', () => {
    expect(cleanSlugName('-wandering-c812')).toBe('wandering');
  });

  it('strips leading dash but preserves pure-digit suffix', () => {
    expect(cleanSlugName('-wandering-1861')).toBe('wandering-1861');
  });

  it('strips 3+ digit numeric prefix (Strava/Rails ID)', () => {
    expect(cleanSlugName('302-evening-ride')).toBe('evening-ride');
  });

  it('strips 3+ digit numeric prefix with leading dash', () => {
    expect(cleanSlugName('-302-evening-ride')).toBe('evening-ride');
  });

  it('strips trailing 4-char hex hash suffix with hex letter', () => {
    expect(cleanSlugName('afternoon-ride-ab3a')).toBe('afternoon-ride');
  });

  it('preserves trailing 4-char pure-digit suffix', () => {
    expect(cleanSlugName('afternoon-ride-6136')).toBe('afternoon-ride-6136');
  });

  it('strips both leading dash and hex hash suffix', () => {
    expect(cleanSlugName('-afternoon-ride-ab3a')).toBe('afternoon-ride');
  });

  it('preserves 1-2 digit number that is part of the name', () => {
    expect(cleanSlugName('6-sprints')).toBe('6-sprints');
  });

  it('preserves 2-digit number that is part of the name', () => {
    expect(cleanSlugName('31-the-1250')).toBe('31-the-1250');
  });

  it('leaves clean slug unchanged', () => {
    expect(cleanSlugName('perfect-day')).toBe('perfect-day');
  });

  it('leaves already date-prefixed slug unchanged', () => {
    expect(cleanSlugName('2025-06-15-perfect-day')).toBe('2025-06-15-perfect-day');
  });

  it('handles slug that is only a numeric prefix', () => {
    // e.g. filename was DD-NNN.gpx → slug is "NNN" → should not strip (nothing left)
    expect(cleanSlugName('302')).toBe('302');
  });

  it('handles multiple dashes at start', () => {
    expect(cleanSlugName('--double-dash')).toBe('double-dash');
  });

  it('strips numeric prefix from eurobiketrip slug', () => {
    // 09-eurobiketrip-schiphol... → not stripped (09 is 2 digits, part of name)
    expect(cleanSlugName('09-eurobiketrip-schiphol')).toBe('09-eurobiketrip-schiphol');
  });
});
