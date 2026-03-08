import { describe, it, expect } from 'vitest';
import { updateSharedKeys } from '../../src/lib/photo-registry';

import type { SharedKeysMap } from '../../src/lib/photo-registry';

describe('updateSharedKeys', () => {
  it('adds a usage to an empty map', () => {
    const map: SharedKeysMap = new Map();
    updateSharedKeys(map, 'photo-abc', { type: 'route', slug: 'canal-path' }, 'add');
    expect(map.get('photo-abc')).toEqual([{ type: 'route', slug: 'canal-path' }]);
  });

  it('adds a second usage for the same key', () => {
    const map: SharedKeysMap = new Map();
    updateSharedKeys(map, 'photo-abc', { type: 'route', slug: 'canal-path' }, 'add');
    updateSharedKeys(map, 'photo-abc', { type: 'place', slug: 'flora' }, 'add');
    expect(map.get('photo-abc')).toEqual([
      { type: 'route', slug: 'canal-path' },
      { type: 'place', slug: 'flora' },
    ]);
  });

  it('removes a usage', () => {
    const map: SharedKeysMap = new Map();
    updateSharedKeys(map, 'photo-abc', { type: 'route', slug: 'canal-path' }, 'add');
    updateSharedKeys(map, 'photo-abc', { type: 'place', slug: 'flora' }, 'add');
    updateSharedKeys(map, 'photo-abc', { type: 'place', slug: 'flora' }, 'remove');
    expect(map.get('photo-abc')).toEqual([{ type: 'route', slug: 'canal-path' }]);
  });

  it('deletes the key when last usage is removed', () => {
    const map: SharedKeysMap = new Map();
    updateSharedKeys(map, 'photo-abc', { type: 'route', slug: 'canal-path' }, 'add');
    updateSharedKeys(map, 'photo-abc', { type: 'route', slug: 'canal-path' }, 'remove');
    expect(map.has('photo-abc')).toBe(false);
  });

  it('is idempotent for duplicate adds', () => {
    const map: SharedKeysMap = new Map();
    updateSharedKeys(map, 'photo-abc', { type: 'route', slug: 'canal-path' }, 'add');
    updateSharedKeys(map, 'photo-abc', { type: 'route', slug: 'canal-path' }, 'add');
    expect(map.get('photo-abc')).toEqual([{ type: 'route', slug: 'canal-path' }]);
  });

  it('handles remove for non-existent key gracefully', () => {
    const map: SharedKeysMap = new Map();
    updateSharedKeys(map, 'photo-abc', { type: 'route', slug: 'canal-path' }, 'remove');
    expect(map.has('photo-abc')).toBe(false);
  });
});
