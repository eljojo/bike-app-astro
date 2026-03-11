import { describe, it, expect } from 'vitest';
import { countryToFlag } from '../src/lib/country-flags';

describe('countryToFlag', () => {
  it('maps country name to flag emoji', () => {
    expect(countryToFlag('Germany')).toBe('🇩🇪');
    expect(countryToFlag('Canada')).toBe('🇨🇦');
    expect(countryToFlag('Netherlands')).toBe('🇳🇱');
    expect(countryToFlag('Belgium')).toBe('🇧🇪');
    expect(countryToFlag('France')).toBe('🇫🇷');
    expect(countryToFlag('Chile')).toBe('🇨🇱');
  });

  it('is case-insensitive', () => {
    expect(countryToFlag('germany')).toBe('🇩🇪');
    expect(countryToFlag('CANADA')).toBe('🇨🇦');
  });

  it('returns empty string for unknown country', () => {
    expect(countryToFlag('Unknown')).toBe('');
    expect(countryToFlag('')).toBe('');
  });
});
