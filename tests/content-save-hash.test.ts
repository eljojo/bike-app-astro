import { describe, it, expect } from 'vitest';
import { computeBlobSha } from '../src/lib/git/git-utils';

describe('computeBlobSha', () => {
  it('matches git hash-object output', () => {
    // Verified via: echo -n "hello" | git hash-object --stdin
    expect(computeBlobSha('hello')).toBe('b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0');
  });

  it('handles content with newlines (typical frontmatter)', () => {
    const content = '---\nname: Test\n---\n\nHello world\n';
    const sha = computeBlobSha(content);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    // Deterministic
    expect(computeBlobSha(content)).toBe(sha);
  });

  it('different content produces different SHA', () => {
    expect(computeBlobSha('A')).not.toBe(computeBlobSha('B'));
  });
});
