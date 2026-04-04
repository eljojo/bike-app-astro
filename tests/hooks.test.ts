import { describe, it, expect } from 'vitest';
import { reorderItems } from '../src/lib/hooks';

describe('reorderItems', () => {
  it('moves item forward', () => {
    expect(reorderItems(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves item backward', () => {
    expect(reorderItems(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('no-op for same index', () => {
    expect(reorderItems(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
  });
});
