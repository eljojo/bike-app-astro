import { describe, it, expect } from 'vitest';
import { buildLfsPointer } from '../src/lib/git-lfs';

describe('buildLfsPointer', () => {
  it('generates correct LFS pointer format', () => {
    const pointer = buildLfsPointer(
      'abc123def456',
      1234
    );
    expect(pointer).toBe(
      'version https://git-lfs.github.com/spec/v1\n' +
      'oid sha256:abc123def456\n' +
      'size 1234\n'
    );
  });
});
