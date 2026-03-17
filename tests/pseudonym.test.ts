import { describe, it, expect } from 'vitest';
import { generatePseudonym } from '../src/lib/auth/pseudonym';

describe('generatePseudonym', () => {
  it('returns a string matching cyclist-XXXX pattern', () => {
    const name = generatePseudonym();
    expect(name).toMatch(/^cyclist-[a-z0-9]{4}$/);
  });

  it('generates unique names', () => {
    const names = new Set(Array.from({ length: 100 }, () => generatePseudonym()));
    expect(names.size).toBeGreaterThan(90);
  });
});
