import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from './test-db';
import type { Database } from '../src/db';
import { calendarFeedCache } from '../src/db/schema';
import type { ParsedFeed } from '../src/lib/calendar-suggestions/types';
import { readCachedFeed, writeCachedFeed } from '../src/lib/calendar-suggestions/cache.server';

describe('calendar feed cache', () => {
  let h: ReturnType<typeof createTestDb>;
  beforeEach(() => { h = createTestDb(); });
  afterEach(() => { h.cleanup(); });

  const sampleFeed: ParsedFeed = {
    fetched_at: '2026-04-21T00:00:00.000Z',
    source_url: 'https://example.com/feed.ics',
    events: [
      { uid: 'a@x', summary: 'Ride A', start: '2026-05-01T10:00:00.000Z' },
    ],
  };

  test('returns null when no row exists', async () => {
    expect(await readCachedFeed(h.db as unknown as Database, 'unknown-org')).toBeNull();
  });

  test('write then read returns the same feed', async () => {
    const db = h.db as unknown as Database;
    await writeCachedFeed(db, 'queer-bike-club', 'https://example.com/feed.ics', sampleFeed);
    const read = await readCachedFeed(db, 'queer-bike-club');
    expect(read).toEqual(sampleFeed);
  });

  test('returns null when the cached row is older than 1 hour', async () => {
    const staleIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await h.db.insert(calendarFeedCache).values({
      organizerSlug: 'queer-bike-club',
      sourceUrl: 'https://example.com/feed.ics',
      eventsJson: JSON.stringify(sampleFeed),
      updatedAt: staleIso,
    }).run();
    expect(await readCachedFeed(h.db as unknown as Database, 'queer-bike-club')).toBeNull();
  });

  test('subsequent write overwrites the prior cache', async () => {
    const db = h.db as unknown as Database;
    await writeCachedFeed(db, 'queer-bike-club', 'https://example.com/feed.ics', sampleFeed);
    const next: ParsedFeed = { ...sampleFeed, events: [{ uid: 'b@x', summary: 'Ride B', start: '2026-05-08T10:00:00.000Z' }] };
    await writeCachedFeed(db, 'queer-bike-club', 'https://example.com/feed.ics', next);
    const read = await readCachedFeed(db, 'queer-bike-club');
    expect(read?.events[0].uid).toBe('b@x');
  });
});
