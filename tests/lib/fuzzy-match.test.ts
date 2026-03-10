import { describe, it, expect } from 'vitest';
import { fuzzyMatchOrganizer } from '../../src/lib/fuzzy-match';

const organizers = [
  { slug: 'citizens-for-safe-cycling', name: 'Citizens for Safe Cycling' },
  { slug: 'ottawa-bicycle-club', name: 'Ottawa Bicycle Club' },
  { slug: 'bike-ottawa', name: 'Bike Ottawa' },
  { slug: 'ldw', name: 'Long Distance Wildcats' },
];

describe('fuzzyMatchOrganizer', () => {
  it('returns exact match with high confidence', () => {
    const result = fuzzyMatchOrganizer('Citizens for Safe Cycling', organizers);
    expect(result).toEqual({ slug: 'citizens-for-safe-cycling', name: 'Citizens for Safe Cycling', confidence: 1 });
  });

  it('returns case-insensitive match', () => {
    const result = fuzzyMatchOrganizer('citizens for safe cycling', organizers);
    expect(result?.slug).toBe('citizens-for-safe-cycling');
    expect(result?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('matches partial/contained strings', () => {
    const result = fuzzyMatchOrganizer('Safe Cycling', organizers);
    expect(result?.slug).toBe('citizens-for-safe-cycling');
    expect(result?.confidence).toBeGreaterThan(0.5);
    expect(result?.confidence).toBeLessThan(1);
  });

  it('matches abbreviation-like input', () => {
    const result = fuzzyMatchOrganizer('LDW', organizers);
    expect(result?.slug).toBe('ldw');
  });

  it('returns null for no match', () => {
    const result = fuzzyMatchOrganizer('Random Org', organizers);
    expect(result).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(fuzzyMatchOrganizer('', organizers)).toBeNull();
  });
});
