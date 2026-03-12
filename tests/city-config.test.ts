import { describe, it, expect } from 'vitest';
import { isClubInstance, isBlogInstance, getCityConfig } from '../src/lib/city-config';

describe('city-config exports', () => {
  it('exports getCityConfig', () => {
    expect(typeof getCityConfig).toBe('function');
  });

  it('exports isBlogInstance', () => {
    expect(typeof isBlogInstance).toBe('function');
  });

  it('exports isClubInstance', () => {
    expect(typeof isClubInstance).toBe('function');
  });
});

describe('isClubInstance', () => {
  it('returns false for the test environment', () => {
    // The test environment uses CITY=demo (or ottawa), which is a wiki instance
    expect(isClubInstance()).toBe(false);
  });

  it('checks instance_type === club', () => {
    const config = getCityConfig();
    // If instance_type is not 'club', isClubInstance should be false
    expect(isClubInstance()).toBe(config.instance_type === 'club');
  });
});

describe('isBlogInstance', () => {
  it('returns false for the test environment', () => {
    expect(isBlogInstance()).toBe(false);
  });

  it('is mutually exclusive with isClubInstance', () => {
    // Both can't be true at the same time
    expect(isBlogInstance() && isClubInstance()).toBe(false);
  });
});
