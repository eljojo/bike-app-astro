import { describe, it, expect } from 'vitest';
import { formatDistance, formatElevation, formatSpeed } from '../src/lib/format';

describe('formatDistance', () => {
  it('formats with no decimals by default', () => {
    expect(formatDistance(42.567)).toBe('43 km');
  });
  it('formats with specified decimals', () => {
    expect(formatDistance(42.567, 2)).toBe('42.57 km');
  });
});

describe('formatElevation', () => {
  it('rounds to nearest meter', () => {
    expect(formatElevation(350.7)).toBe('351 m');
  });
});

describe('formatSpeed', () => {
  it('formats with 1 decimal by default', () => {
    expect(formatSpeed(22.456)).toBe('22.5 km/h');
  });
});
