import type { CalendarFeedCache } from './feed-cache.service';
import type { ParsedFeed } from '../calendar-suggestions/types';

interface KVNamespace {
  get(key: string, type: 'text'): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

// Stored shape inside the KV value. Carrying source_url lets us treat a feed-URL
// change on the organizer as stale without waiting for TTL expiry.
interface Stored {
  source_url: string;
  feed: ParsedFeed;
}

/**
 * KV-backed calendar feed cache. Reuses the TILE_CACHE binding with a distinct
 * `calfeed:feed:v4:` key prefix so tile and feed entries cannot collide. Per-entry
 * TTL handles eviction — no background cleanup needed.
 *
 * Bump the `vN:` segment whenever the stored ParsedFeed shape changes in a way
 * that older cached payloads can't be safely reinterpreted (e.g. event `start`
 * went from UTC ISO to local-with-offset). Bumping makes every old key look
 * absent — they orphan and TTL out, new reads miss and re-fetch fresh.
 */
export function createKvCalendarFeedCache(kv: KVNamespace): CalendarFeedCache {
  return {
    async get(slug, expectedSourceUrl) {
      const raw = await kv.get(`calfeed:feed:v4:${slug}`, 'text');
      if (!raw) return null;
      let parsed: Stored;
      try { parsed = JSON.parse(raw) as Stored; }
      catch { return null; }
      if (parsed.source_url !== expectedSourceUrl) return null;
      return parsed.feed;
    },
    async put(slug, sourceUrl, feed, ttlSeconds) {
      const value: Stored = { source_url: sourceUrl, feed };
      await kv.put(`calfeed:feed:v4:${slug}`, JSON.stringify(value), { expirationTtl: ttlSeconds });
    },
  };
}
