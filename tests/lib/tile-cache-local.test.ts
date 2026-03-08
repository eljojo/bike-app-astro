import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createLocalTileCache } from '../../src/lib/tile-cache-local';
import type { TileCache } from '../../src/lib/tile-cache';

const TEST_DIR = path.join(import.meta.dirname, '../../.data/test-tile-cache');

describe('LocalTileCache', () => {
  let cache: TileCache;

  beforeEach(() => {
    cache = createLocalTileCache(TEST_DIR);
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('returns null for missing keys', async () => {
    expect(await cache.get('missing/key')).toBeNull();
  });

  it('stores and retrieves a buffer', async () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    await cache.put('tiles/14/4662/2983.pbf', data, 86400);
    const result = await cache.get('tiles/14/4662/2983.pbf');
    expect(result).not.toBeNull();
    expect(new Uint8Array(result!)).toEqual(data);
  });

  it('stores and retrieves text as buffer', async () => {
    const json = JSON.stringify({ version: 8, sources: {} });
    const data = new TextEncoder().encode(json);
    await cache.put('style.json', data, 86400);
    const result = await cache.get('style.json');
    expect(new TextDecoder().decode(result!)).toBe(json);
  });

  it('creates nested directories for key paths', async () => {
    const data = new Uint8Array([5, 6]);
    await cache.put('deep/nested/path/tile.pbf', data, 86400);
    const result = await cache.get('deep/nested/path/tile.pbf');
    expect(result).not.toBeNull();
  });

  it('returns null for expired entries', async () => {
    const data = new Uint8Array([1]);
    await cache.put('expires/soon.pbf', data, 0);
    // TTL of 0 means already expired
    expect(await cache.get('expires/soon.pbf')).toBeNull();
  });
});
