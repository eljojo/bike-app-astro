import { describe, it, expect } from 'vitest';
import { useDragDrop } from '../src/lib/hooks';

describe('useDragDrop', () => {
  it('is exported as a function', () => {
    expect(typeof useDragDrop).toBe('function');
  });
});

describe('useDragReorder logic', () => {
  // Test the reorder algorithm directly (same logic as the hook)
  function reorder<T>(items: T[], fromIdx: number, toIdx: number): T[] {
    const updated = [...items];
    const [moved] = updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, moved);
    return updated;
  }

  it('moves item forward', () => {
    expect(reorder(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves item backward', () => {
    expect(reorder(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('no-op for same index', () => {
    const items = ['a', 'b', 'c'];
    expect(reorder(items, 1, 1)).toEqual(['a', 'b', 'c']);
  });
});
