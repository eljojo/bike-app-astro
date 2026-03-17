import { describe, it, expect } from 'vitest';
import { isClubInstance, isBlogInstance } from '../src/lib/config/city-config';

describe('isClubInstance', () => {
  it('returns false for the test environment', () => {
    // The test environment uses CITY=demo (or ottawa), which is a wiki instance
    expect(isClubInstance()).toBe(false);
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
