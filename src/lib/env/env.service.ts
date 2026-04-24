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

import type { AppEnv } from '../config/app-env';
import type { TileCache } from '../tile-cache/tile-cache.service';
import type { CalendarFeedCache } from '../calendar-feed-cache/feed-cache.service';

let _env: AppEnv;
let _openLocalDb: ((path: string) => unknown) | undefined;
let _localDbPath: string | undefined;
let _tileCache: TileCache;
let _calendarFeedCache: CalendarFeedCache;

if (process.env.RUNTIME === 'local') {
  const { createLocalEnv, openLocalDb, createLocalTileCacheFromEnv, createLocalCalendarFeedCacheFromEnv }
    = await import('./env.adapter-local');
  _env = createLocalEnv();
  _openLocalDb = openLocalDb;
  _localDbPath = ((_env.DB as Record<string, unknown>).$client as Record<string, unknown>).name as string;
  _tileCache = createLocalTileCacheFromEnv();
  _calendarFeedCache = createLocalCalendarFeedCacheFromEnv();
} else {
  const cf = await import('cloudflare:workers');
  _env = cf.env as AppEnv;
  const { createKvTileCache } = await import('../tile-cache/tile-cache.adapter-kv');
  const { createKvCalendarFeedCache } = await import('../calendar-feed-cache/feed-cache.adapter-kv');
  _tileCache = createKvTileCache(_env.TILE_CACHE as Parameters<typeof createKvTileCache>[0]);
  // Feed cache reuses the TILE_CACHE binding with a distinct key prefix.
  _calendarFeedCache = createKvCalendarFeedCache(_env.TILE_CACHE as Parameters<typeof createKvCalendarFeedCache>[0]);
}

export const env: AppEnv = _env;
export const openLocalDb = _openLocalDb;
export const localDbPath = _localDbPath;
export const tileCache: TileCache = _tileCache;
export const calendarFeedCache: CalendarFeedCache = _calendarFeedCache;
