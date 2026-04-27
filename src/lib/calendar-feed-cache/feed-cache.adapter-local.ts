import fs from 'node:fs';
import path from 'node:path';
import type { CalendarFeedCache } from './feed-cache.service';
import type { ParsedFeed } from '../calendar-suggestions/types';

interface Stored {
  source_url: string;
  feed: ParsedFeed;
}

interface Meta {
  expires_at: number; // ms since epoch
}

/**
 * Filesystem-backed CalendarFeedCache for local dev. Data in `<slug>.json`,
 * expiry in `<slug>.meta.json`. Mirrors `tile-cache.adapter-local.ts` in shape,
 * differs only in that the value is JSON text (not binary).
 */
export function createLocalCalendarFeedCache(cacheDir: string): CalendarFeedCache {
  fs.mkdirSync(cacheDir, { recursive: true });

  function dataPath(slug: string): string {
    return path.join(cacheDir, `${slug.replace(/[^a-zA-Z0-9._\-]/g, '_')}.json`);
  }
  function metaPath(slug: string): string {
    return dataPath(slug) + '.meta';
  }

  return {
    async get(slug, expectedSourceUrl) {
      const dp = dataPath(slug);
      const mp = metaPath(slug);
      if (!fs.existsSync(dp) || !fs.existsSync(mp)) return null;

      let meta: Meta;
      try { meta = JSON.parse(fs.readFileSync(mp, 'utf-8')) as Meta; }
      catch { return null; }
      if (Date.now() >= meta.expires_at) {
        try { fs.unlinkSync(dp); } catch { /* ignore */ }
        try { fs.unlinkSync(mp); } catch { /* ignore */ }
        return null;
      }

      let stored: Stored;
      try { stored = JSON.parse(fs.readFileSync(dp, 'utf-8')) as Stored; }
      catch { return null; }
      if (stored.source_url !== expectedSourceUrl) return null;
      return stored.feed;
    },
    async put(slug, sourceUrl, feed, ttlSeconds) {
      const value: Stored = { source_url: sourceUrl, feed };
      fs.writeFileSync(dataPath(slug), JSON.stringify(value));
      fs.writeFileSync(metaPath(slug), JSON.stringify({ expires_at: Date.now() + ttlSeconds * 1000 } satisfies Meta));
    },
  };
}
