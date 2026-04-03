import { describe, it, expect } from 'vitest';
import { deriveSurface, deriveBeginnerFriendly } from '../src/lib/route-facts';

describe('deriveSurface', () => {
  it('returns "paved_separated" for bike path tag', () => {
    expect(deriveSurface(['bike path', 'scenic'])).toBe('paved_separated');
  });

  it('returns "gravel" for gravel tag', () => {
    expect(deriveSurface(['gravel', 'scenic'])).toBe('gravel');
  });

  it('returns "road" for road tag', () => {
    expect(deriveSurface(['road'])).toBe('road');
  });

  it('returns "trail" for single track tag', () => {
    expect(deriveSurface(['single track'])).toBe('trail');
  });

  it('returns null for no surface tags', () => {
    expect(deriveSurface(['scenic', 'chill'])).toBe(null);
  });

  it('prefers bike path over road when both present', () => {
    expect(deriveSurface(['bike path', 'road'])).toBe('paved_separated');
  });
});

describe('deriveBeginnerFriendly', () => {
  it('returns true for bike path + easy', () => {
    expect(deriveBeginnerFriendly(['bike path', 'easy'])).toBe(true);
  });

  it('returns true for bike path + family friendly', () => {
    expect(deriveBeginnerFriendly(['bike path', 'family friendly'])).toBe(true);
  });

  it('returns true for bike path + chill', () => {
    expect(deriveBeginnerFriendly(['bike path', 'chill'])).toBe(true);
  });

  it('returns false for gravel + easy', () => {
    expect(deriveBeginnerFriendly(['gravel', 'easy'])).toBe(false);
  });

  it('returns false for bike path without easy/chill/family', () => {
    expect(deriveBeginnerFriendly(['bike path', 'scenic'])).toBe(false);
  });

  it('returns false for no relevant tags', () => {
    expect(deriveBeginnerFriendly(['scenic'])).toBe(false);
  });
});
