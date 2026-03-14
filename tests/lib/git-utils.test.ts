import { describe, it, expect } from 'vitest';
import { computeBlobSha } from '../../src/lib/git/git-utils';

describe('computeBlobSha', () => {
  it('computes SHA-1 matching git blob format', () => {
    // "hello\n" has a known git blob SHA
    const sha = computeBlobSha('hello\n');
    expect(sha).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });

  it('handles empty string', () => {
    const sha = computeBlobSha('');
    expect(sha).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  });
});
