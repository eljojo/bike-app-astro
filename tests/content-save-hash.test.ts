import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';

/** Compute a git blob SHA (same as GitHub's Contents API returns). */
function computeBlobSha(content: string): string {
  return createHash('sha1')
    .update(`blob ${Buffer.byteLength(content)}\0${content}`)
    .digest('hex');
}

describe('git blob SHA computation', () => {
  it('computes the same SHA that git would for a file', () => {
    const content = '---\nname: Test\n---\n\nHello world\n';
    const sha = computeBlobSha(content);
    // SHA-1 is 40 hex chars
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    // Same content always produces same SHA
    expect(computeBlobSha(content)).toBe(sha);
  });

  it('different content produces different SHA', () => {
    const sha1 = computeBlobSha('content A');
    const sha2 = computeBlobSha('content B');
    expect(sha1).not.toBe(sha2);
  });
});
