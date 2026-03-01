import { describe, it, expect } from 'vitest';
import { formatDistance } from '../src/lib/distance';

describe('formatDistance', () => {
  it('shows exact distance for single variant', () => {
    expect(formatDistance([34.3])).toBe('35 km');
  });

  it('shows range when variants differ by more than 5km', () => {
    expect(formatDistance([34.3, 40.8])).toBe('35-40 km');
  });

  it('shows single value when variants are close', () => {
    expect(formatDistance([34.3, 36.1])).toBe('35 km');
  });

  it('rounds to nearest 5', () => {
    expect(formatDistance([13])).toBe('15 km');
    expect(formatDistance([17])).toBe('15 km');
    expect(formatDistance([22])).toBe('20 km');
  });

  it('returns empty string for empty array', () => {
    expect(formatDistance([])).toBe('');
  });

  it('handles multiple variants with wide spread', () => {
    expect(formatDistance([10, 25, 50])).toBe('10-50 km');
  });

  it('uses rounded min and max for range', () => {
    expect(formatDistance([12, 43])).toBe('10-45 km');
  });
});
