import { describe, it, expect } from 'vitest';
import { randomKey } from '../src/lib/storage';

describe('randomKey', () => {
  it('returns an 8-character string', () => {
    const key = randomKey();
    expect(key).toHaveLength(8);
  });

  it('contains only alphanumeric characters (base36)', () => {
    for (let i = 0; i < 100; i++) {
      const key = randomKey();
      expect(key).toMatch(/^[0-9a-z]{8}$/);
    }
  });

  it('generates unique keys', () => {
    const keys = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      keys.add(randomKey());
    }
    // With 36^8 possible values, 1000 keys should all be unique
    expect(keys.size).toBe(1000);
  });

  it('uses the full base36 character set', () => {
    const allChars = new Set<string>();
    // Generate enough keys to see most characters
    for (let i = 0; i < 5000; i++) {
      for (const ch of randomKey()) {
        allChars.add(ch);
      }
    }
    // Should see digits and letters
    expect(allChars.has('0')).toBe(true);
    expect(allChars.has('9')).toBe(true);
    expect(allChars.has('a')).toBe(true);
    expect(allChars.has('z')).toBe(true);
  });
});
