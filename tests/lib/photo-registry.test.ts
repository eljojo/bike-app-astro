import { describe, it, expect } from 'vitest';
import {
  updateSharedKeys, buildSharedKeysMap, getPhotoUsages,
  serializeSharedKeys, deserializeSharedKeys,
} from '../../src/lib/photo-registry';

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

describe('buildSharedKeysMap', () => {
  const routeData = {
    'canal-path': { media: [{ key: 'photo-abc' }, { key: 'photo-def' }] },
    'experimental-farm': { media: [{ key: 'photo-abc' }, { key: 'photo-ghi' }] },
  };
  const places = [
    { slug: 'flora', photo_key: 'photo-def' },
    { slug: 'lansdowne', photo_key: 'photo-xyz' },
  ];
  const events = [
    { slug: '2099/bike-fest', poster_key: 'photo-ghi' },
  ];
  const parkedPhotos = [
    { key: 'photo-parked' },
  ];

  it('returns only multi-referenced keys', () => {
    const map = buildSharedKeysMap(routeData, places, events, parkedPhotos);
    // photo-abc: canal-path + experimental-farm (2 routes)
    // photo-def: canal-path + flora (route + place)
    // photo-ghi: experimental-farm + bike-fest (route + event)
    expect(map.size).toBe(3);
    expect(map.has('photo-abc')).toBe(true);
    expect(map.has('photo-def')).toBe(true);
    expect(map.has('photo-ghi')).toBe(true);
    // Single-use keys NOT in map
    expect(map.has('photo-xyz')).toBe(false);
    expect(map.has('photo-parked')).toBe(false);
  });

  it('includes correct usages per key', () => {
    const map = buildSharedKeysMap(routeData, places, events, parkedPhotos);
    expect(map.get('photo-abc')).toEqual([
      { type: 'route', slug: 'canal-path' },
      { type: 'route', slug: 'experimental-farm' },
    ]);
    expect(map.get('photo-def')).toEqual([
      { type: 'route', slug: 'canal-path' },
      { type: 'place', slug: 'flora' },
    ]);
    expect(map.get('photo-ghi')).toEqual([
      { type: 'route', slug: 'experimental-farm' },
      { type: 'event', slug: '2099/bike-fest' },
    ]);
  });

  it('produces same result as incremental updates', () => {
    // Build via bulk
    const bulkMap = buildSharedKeysMap(routeData, places, events, parkedPhotos);

    // Build incrementally (same data, one at a time)
    const incrementalMap: SharedKeysMap = new Map();
    for (const [slug, route] of Object.entries(routeData)) {
      for (const item of route.media) {
        updateSharedKeys(incrementalMap, item.key, { type: 'route', slug }, 'add');
      }
    }
    for (const place of places) {
      if (place.photo_key) {
        updateSharedKeys(incrementalMap, place.photo_key, { type: 'place', slug: place.slug }, 'add');
      }
    }
    for (const event of events) {
      if (event.poster_key) {
        updateSharedKeys(incrementalMap, event.poster_key, { type: 'event', slug: event.slug }, 'add');
      }
    }
    for (const parked of parkedPhotos) {
      updateSharedKeys(incrementalMap, parked.key, { type: 'parked', slug: '__global' }, 'add');
    }
    // Prune single-use keys (same as buildSharedKeysMap does)
    for (const [key, usages] of incrementalMap) {
      if (usages.length < 2) incrementalMap.delete(key);
    }

    expect(bulkMap).toEqual(incrementalMap);
  });
});

describe('getPhotoUsages', () => {
  it('returns usages for a multi-referenced key', () => {
    const map: SharedKeysMap = new Map();
    map.set('photo-abc', [
      { type: 'route', slug: 'canal-path' },
      { type: 'place', slug: 'flora' },
    ]);
    expect(getPhotoUsages(map, 'photo-abc')).toEqual([
      { type: 'route', slug: 'canal-path' },
      { type: 'place', slug: 'flora' },
    ]);
  });

  it('returns empty array for single-use or unknown key', () => {
    const map: SharedKeysMap = new Map();
    expect(getPhotoUsages(map, 'unknown-key')).toEqual([]);
  });
});

describe('serialization', () => {
  it('round-trips through JSON', () => {
    const map: SharedKeysMap = new Map();
    map.set('photo-abc', [
      { type: 'route', slug: 'canal-path' },
      { type: 'place', slug: 'flora' },
    ]);
    map.set('photo-def', [
      { type: 'event', slug: '2099/bike-fest' },
      { type: 'parked', slug: '__global' },
    ]);

    const json = serializeSharedKeys(map);
    const restored = deserializeSharedKeys(json);
    expect(restored).toEqual(map);
  });

  it('deserializes empty object to empty map', () => {
    const map = deserializeSharedKeys('{}');
    expect(map.size).toBe(0);
  });
});
