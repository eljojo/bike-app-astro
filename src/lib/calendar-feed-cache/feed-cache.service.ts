import type { ParsedFeed } from '../calendar-suggestions/types';

/**
 * Hot cache of parsed upstream ICS feeds, keyed by organizer slug.
 *
 * - `get(slug, expectedSourceUrl)` returns null when the entry is missing, expired,
 *   or was cached from a different `ics_url` than the organizer currently configures
 *   (treats URL repoint as stale).
 * - `put(...)` stores with a TTL; the entry auto-expires at the storage layer.
 *
 * Pure-KV shape: opaque value keyed by slug. No relational queries inside.
 */
export interface CalendarFeedCache {
  get(slug: string, expectedSourceUrl: string): Promise<ParsedFeed | null>;
  put(slug: string, sourceUrl: string, feed: ParsedFeed, ttlSeconds: number): Promise<void>;
}
