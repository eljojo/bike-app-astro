/**
 * Platform environment bindings.
 *
 * This is the ONLY file that imports from 'cloudflare:workers'.
 * Everything else imports from here. If the platform changes,
 * only this file needs to be updated.
 *
 * When RUNTIME=local (dev mode), we use local implementations
 * instead of Cloudflare bindings — local SQLite, local filesystem,
 * local git.
 */

import type { AppEnv } from './app-env';
import type { TileCache } from './tile-cache/tile-cache.service';

let _env: AppEnv;
let _openLocalDb: ((path: string) => unknown) | undefined;
let _localDbPath: string | undefined;
let _tileCache: TileCache;

if (process.env.RUNTIME === 'local') {
  const { createLocalEnv, openLocalDb, createLocalTileCacheFromEnv } = await import('./env-local');
  _env = createLocalEnv();
  _openLocalDb = openLocalDb;
  _localDbPath = ((_env.DB as Record<string, unknown>).$client as Record<string, unknown>).name as string;
  _tileCache = createLocalTileCacheFromEnv();
} else {
  const cf = await import('cloudflare:workers');
  _env = cf.env as AppEnv;
  const { createKvTileCache } = await import('./tile-cache/tile-cache.adapter-kv');
  _tileCache = createKvTileCache(_env.TILE_CACHE as Parameters<typeof createKvTileCache>[0]);
}

export const env: AppEnv = _env;
export const openLocalDb = _openLocalDb;
export const localDbPath = _localDbPath;
export const tileCache: TileCache = _tileCache;
