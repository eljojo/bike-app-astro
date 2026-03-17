import { describe, it, expect } from 'vitest';
import { computeHashFromParts } from '../src/lib/models/content-hash.server';

describe('computeHashFromParts', () => {
  it('hashes single part', () => {
    const h = computeHashFromParts('hello');
    expect(h).toMatch(/^[a-f0-9]+$/);
  });

  it('ignores undefined parts', () => {
    const h1 = computeHashFromParts('hello', undefined, undefined);
    const h2 = computeHashFromParts('hello');
    expect(h1).toBe(h2);
  });

  it('different content produces different hash', () => {
    expect(computeHashFromParts('a')).not.toBe(computeHashFromParts('b'));
  });

  it('order matters', () => {
    expect(computeHashFromParts('a', 'b')).not.toBe(computeHashFromParts('b', 'a'));
  });
});
