import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from './test-db';
import type { Database } from '../src/db';
import { dismissSuggestion } from '../src/lib/calendar-suggestions/dismissals.server';
import { advanceSnapshot, loadAllSnapshots } from '../src/lib/calendar-suggestions/snapshots.server';
import type { ParsedFeed, ParsedVEvent, UpdateDiff, ReviewSuggestion, ImportSuggestion } from '../src/lib/calendar-suggestions/types';
import type { CalendarFeedCache } from '../src/lib/calendar-feed-cache/feed-cache.service';
import { buildSuggestions } from '../src/lib/calendar-suggestions/build.server';
import { toSuggestionItem } from '../src/views/api/admin-calendar-suggestions';

/**
 * In-memory CalendarFeedCache for tests. Mirrors the real adapters' semantics
 * (source-URL check, TTL). Test code writes via `seed()`; `buildSuggestions`
 * reads/writes via the standard interface.
 */
function createInMemoryFeedCache(opts: { failOnPut?: boolean } = {}): CalendarFeedCache & {
  seed(slug: string, sourceUrl: string, feed: ParsedFeed): void;
  putCount(): number;
} {
  const store = new Map<string, { sourceUrl: string; feed: ParsedFeed; expiresAt: number }>();
  let puts = 0;
  return {
    seed(slug, sourceUrl, feed) {
      store.set(slug, { sourceUrl, feed, expiresAt: Date.now() + 3600_000 });
    },
    putCount() { return puts; },
    async get(slug, expectedSourceUrl) {
      const entry = store.get(slug);
      if (!entry) return null;
      if (entry.expiresAt <= Date.now()) return null;
      if (entry.sourceUrl !== expectedSourceUrl) return null;
      return entry.feed;
    },
    async put(slug, sourceUrl, feed, ttlSeconds) {
      puts += 1;
      if (opts.failOnPut) throw new Error('simulated KV put failure');
      store.set(slug, { sourceUrl, feed, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
  };
}

describe('admin calendar suggestions — build logic', () => {
  let h: ReturnType<typeof createTestDb>;
  let db: Database;
  let feedCache: ReturnType<typeof createInMemoryFeedCache>;
  beforeEach(() => {
    h = createTestDb();
    db = h.db as unknown as Database;
    feedCache = createInMemoryFeedCache();
  });
  afterEach(() => { h.cleanup(); });

  function oneOff(uid: string, start: string, summary = 'Ride'): ParsedVEvent {
    return { uid, summary, start };
  }

  function seedFeed(slug: string, events: ParsedVEvent[], sourceUrl = 'https://example.com/feed.ics') {
    const feed: ParsedFeed = {
      fetched_at: new Date().toISOString(),
      source_url: sourceUrl,
      events,
    };
    feedCache.seed(slug, sourceUrl, feed);
  }

  const cacheOnlyFetcher = async () => { throw new Error('cache should serve'); };

  test('hides UIDs that already appear on repo events', async () => {
    seedFeed('qbc', [
      oneOff('already-in-repo@x', '2026-05-01T18:00:00.000Z'),
      oneOff('new@x', '2026-05-08T18:00:00.000Z'),
    ]);
    const suggestions = await buildSuggestions({
      db, city: 'ottawa', feedCache,
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents: [{ id: '2026/a', slug: 'a', year: '2026', name: 'Existing', start_date: '2026-05-01', ics_uid: 'already-in-repo@x', organizer: 'qbc' }],
      fetcher: cacheOnlyFetcher,
      siteTz: 'UTC',
      now: new Date('2026-04-21T00:00:00Z'),
    });
    expect(suggestions.map(s => s.uid)).toEqual(['new@x']);
  });

  test('hides UIDs that are dismissed', async () => {
    seedFeed('qbc', [
      oneOff('dismissed@x', '2026-05-01T18:00:00.000Z'),
      oneOff('keep@x', '2026-05-08T18:00:00.000Z'),
    ]);
    await dismissSuggestion(db, 'ottawa', 'qbc', 'dismissed@x', '2026-05-10');
    const suggestions = await buildSuggestions({
      db, city: 'ottawa', feedCache,
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents: [],
      fetcher: cacheOnlyFetcher,
      siteTz: 'UTC',
      now: new Date('2026-04-21T00:00:00Z'),
    });
    expect(suggestions.map(s => s.uid)).toEqual(['keep@x']);
  });

  test('hides one-off when same-organizer event exists on the same start_date', async () => {
    seedFeed('qbc', [
      oneOff('no-uid-match@x', '2026-05-10T18:00:00.000Z'),
      oneOff('keep@x', '2026-05-17T18:00:00.000Z'),
    ]);
    const suggestions = await buildSuggestions({
      db, city: 'ottawa', feedCache,
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents: [{ id: '2026/manual', slug: 'manual', year: '2026', name: 'Manually Added', start_date: '2026-05-10', organizer: 'qbc' }],
      fetcher: cacheOnlyFetcher,
      siteTz: 'UTC',
      now: new Date('2026-04-21T00:00:00Z'),
    });
    expect(suggestions.map(s => s.uid)).toEqual(['keep@x']);
  });

  test('does NOT hide one-off when same date but different organizer', async () => {
    seedFeed('qbc', [oneOff('keep@x', '2026-05-10T18:00:00.000Z')]);
    const suggestions = await buildSuggestions({
      db, city: 'ottawa', feedCache,
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents: [{ id: '2026/other', slug: 'other', year: '2026', name: 'Other', start_date: '2026-05-10', organizer: 'obmc' }],
      fetcher: cacheOnlyFetcher,
      siteTz: 'UTC',
      now: new Date('2026-04-21T00:00:00Z'),
    });
    expect(suggestions.map(s => s.uid)).toEqual(['keep@x']);
  });

  test('does NOT hide a series by organizer+date match (season_start coincidence)', async () => {
    seedFeed('qbc', [{
      uid: 'series@x', summary: 'Every Monday', start: '2026-05-10T18:00:00.000Z',
      series: { kind: 'recurrence', recurrence: 'weekly', recurrence_day: 'monday', season_start: '2026-05-10', season_end: '2026-09-07' },
    }]);
    const suggestions = await buildSuggestions({
      db, city: 'ottawa', feedCache,
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents: [{ id: '2026/manual', slug: 'manual', year: '2026', name: 'Coincidental', start_date: '2026-05-10', organizer: 'qbc' }],
      fetcher: cacheOnlyFetcher,
      siteTz: 'UTC',
      now: new Date('2026-04-21T00:00:00Z'),
    });
    expect(suggestions.map(s => s.uid)).toEqual(['series@x']);
  });

  test('respects the 180-day horizon', async () => {
    seedFeed('qbc', [
      oneOff('soon@x', '2026-05-01T18:00:00.000Z'),
      oneOff('far@x', '2027-06-01T18:00:00.000Z'),
    ]);
    const suggestions = await buildSuggestions({
      db, city: 'ottawa', feedCache,
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents: [],
      fetcher: cacheOnlyFetcher,
      siteTz: 'UTC',
      now: new Date('2026-04-21T00:00:00Z'),
    });
    expect(suggestions.map(s => s.uid)).toEqual(['soon@x']);
  });

  test('long-running series sorts by NEXT occurrence, not master DTSTART', async () => {
    // The series started in 2024; its next occurrence (Monday 2026-04-27) is
    // AFTER a one-off on Wednesday 2026-04-22. Sorting by master DTSTART would
    // place the series at position 0 (because '2024-...' < '2026-...') and let
    // a long-running series crowd out near-term one-offs. The fix sorts by the
    // next upcoming occurrence.
    seedFeed('qbc', [
      {
        uid: 'old-series@x', summary: 'Established Mondays', start: '2024-04-01T18:00:00',
        series: { kind: 'recurrence', recurrence: 'weekly', recurrence_day: 'monday',
                  season_start: '2024-04-01', season_end: '2026-09-28' },
      },
      oneOff('this-wed@x', '2026-04-22T18:00:00'),  // Wed, before next Monday
    ]);
    const suggestions = await buildSuggestions({
      db, city: 'ottawa', feedCache,
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents: [],
      fetcher: cacheOnlyFetcher,
      siteTz: 'UTC',
      now: new Date('2026-04-21T00:00:00Z'),  // Tuesday — next Monday is 2026-04-27
    });
    expect(suggestions.map(s => s.uid)).toEqual(['this-wed@x', 'old-series@x']);
  });

  test('caps at 10 items sorted by start', async () => {
    seedFeed('qbc', Array.from({ length: 15 }, (_, i) =>
      oneOff(`e${i}@x`, `2026-05-${String(i + 1).padStart(2, '0')}T18:00:00.000Z`)));
    const suggestions = await buildSuggestions({
      db, city: 'ottawa', feedCache,
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents: [],
      fetcher: cacheOnlyFetcher,
      siteTz: 'UTC',
      now: new Date('2026-04-21T00:00:00Z'),
    });
    expect(suggestions).toHaveLength(10);
    expect(suggestions[0].uid).toBe('e0@x');
    expect(suggestions[9].uid).toBe('e9@x');
  });

  test('isolates failure per feed — one bad feed does not block others', async () => {
    seedFeed('good', [oneOff('good@x', '2026-05-01T18:00:00.000Z')], 'https://example.com/good.ics');
    // 'bad' has no cached entry; fetcher throws for that slug.
    const suggestions = await buildSuggestions({
      db, city: 'ottawa', feedCache,
      organizers: [
        { slug: 'good', name: 'Good', ics_url: 'https://example.com/good.ics' },
        { slug: 'bad', name: 'Bad', ics_url: 'https://example.com/bad.ics' },
      ],
      repoEvents: [],
      fetcher: async (url) => {
        if (url.includes('bad')) throw new Error('network error');
        throw new Error('good feed should hit cache');
      },
      siteTz: 'UTC',
      now: new Date('2026-04-21T00:00:00Z'),
    });
    expect(suggestions.map(s => s.uid)).toEqual(['good@x']);
  });

  test('excludes one-off events that have already ended (past events)', async () => {
    seedFeed('qbc', [
      oneOff('past@x', '2026-03-01T18:00:00.000Z'),    // before now=2026-04-21
      oneOff('future@x', '2026-05-01T18:00:00.000Z'),
    ]);
    const suggestions = await buildSuggestions({
      db, city: 'ottawa', feedCache,
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents: [],
      fetcher: cacheOnlyFetcher,
      siteTz: 'UTC',
      now: new Date('2026-04-21T00:00:00Z'),
    });
    expect(suggestions.map(s => s.uid)).toEqual(['future@x']);
  });

  test('westward TZ: keeps an event still going in city-local time even past UTC end', async () => {
    // Event in America/Vancouver on 2026-12-15, 18:00-20:00 PST (= 02:00-04:00Z+1).
    // Real `now` = 2026-12-16T02:30:00Z = 18:30 PST, event still going for 90 min.
    // The naive parser output is `2026-12-15T20:00:00` (no Z); Date(naive) parsed
    // as system-local — on UTC (Workers) it's 20:00Z = 2026-12-15T20:00:00Z,
    // which is < now (2026-12-16T02:30Z) → filtered out (BUG).
    // The fix projects `now` into siteTz and string-compares against the naive
    // site-local clock, never going through Date.
    seedFeed('qbc', [
      {
        uid: 'still-going@x',
        summary: 'Just started',
        start: '2026-12-15T18:00:00',
        end: '2026-12-15T20:00:00',
      },
    ]);
    const suggestions = await buildSuggestions({
      db, city: 'ottawa', feedCache,
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents: [],
      fetcher: cacheOnlyFetcher,
      siteTz: 'America/Vancouver',
      now: new Date('2026-12-16T02:30:00Z'),
    });
    expect(suggestions.map(s => s.uid)).toEqual(['still-going@x']);
  });

  test('TZ-correct season_end: a series ending today site-local stays visible past UTC midnight', async () => {
    // Site=America/Vancouver, season_end='2026-12-15' (today PST).
    // Real now = 2026-12-16T07:30:00Z = 23:30 PST on 2026-12-15 (still today locally).
    // Old code: now.toISOString().slice(0,10) = '2026-12-16'. season_end '2026-12-15'
    // < '2026-12-16' → filtered (the series 'expires' a day early).
    // The fix projects nowDate into siteTz: '2026-12-15'. Comparison stays correct.
    seedFeed('qbc', [
      {
        uid: 'last-day@x',
        summary: 'Final week',
        start: '2026-12-15T18:00:00',
        series: { kind: 'recurrence', recurrence: 'weekly', recurrence_day: 'monday',
                  season_start: '2026-12-15', season_end: '2026-12-15' },
      },
    ]);
    const suggestions = await buildSuggestions({
      db, city: 'ottawa', feedCache,
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents: [],
      fetcher: cacheOnlyFetcher,
      siteTz: 'America/Vancouver',
      now: new Date('2026-12-16T07:30:00Z'),
    });
    expect(suggestions.map(s => s.uid)).toEqual(['last-day@x']);
  });

  test('excludes recurrence series whose season_end has already passed', async () => {
    seedFeed('qbc', [
      {
        uid: 'expired@x', summary: 'Last year\'s series', start: '2025-05-10T18:00:00.000Z',
        series: { kind: 'recurrence', recurrence: 'weekly', recurrence_day: 'monday',
                  season_start: '2025-05-10', season_end: '2025-09-28' },
      },
      {
        uid: 'ongoing@x', summary: 'Still running', start: '2026-03-01T18:00:00.000Z',
        series: { kind: 'recurrence', recurrence: 'weekly', recurrence_day: 'monday',
                  season_start: '2026-03-01', season_end: '2026-09-28' },
      },
    ]);
    const suggestions = await buildSuggestions({
      db, city: 'ottawa', feedCache,
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents: [],
      fetcher: cacheOnlyFetcher,
      siteTz: 'UTC',
      now: new Date('2026-04-21T00:00:00Z'),
    });
    expect(suggestions.map(s => s.uid)).toEqual(['ongoing@x']);
  });

  test('treats a cached feed from a different source URL as stale', async () => {
    seedFeed('qbc', [oneOff('old-feed@x', '2026-05-01T18:00:00.000Z')]);  // seeded at https://example.com/feed.ics
    let fetchCount = 0;
    const suggestions = await buildSuggestions({
      db, city: 'ottawa', feedCache,
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/NEW-feed.ics' }],  // URL changed
      repoEvents: [],
      fetcher: async (url) => {
        fetchCount += 1;
        expect(url).toBe('https://example.com/NEW-feed.ics');
        return {
          fetched_at: new Date().toISOString(),
          source_url: url,
          events: [{ uid: 'new-feed@x', summary: 'From new feed', start: '2026-05-02T18:00:00.000Z' }],
        };
      },
      siteTz: 'UTC',
      now: new Date('2026-04-21T00:00:00Z'),
    });
    expect(fetchCount).toBe(1);
    expect(suggestions.map(s => s.uid)).toEqual(['new-feed@x']);
  });

  test('still returns a parsed feed when feedCache.put throws after a successful fetch', async () => {
    const failingCache = createInMemoryFeedCache({ failOnPut: true });
    const suggestions = await buildSuggestions({
      db,
      city: 'ottawa',
      feedCache: failingCache,
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents: [],
      fetcher: async (url) => ({
        fetched_at: new Date().toISOString(),
        source_url: url,
        events: [{ uid: 'new@x', summary: 'New ride', start: '2026-05-02T18:00:00.000Z' }],
      }),
      siteTz: 'UTC',
      now: new Date('2026-04-21T00:00:00Z'),
    });
    // The feed was parsed successfully — the cache-put failure should not discard it.
    expect(suggestions.map(s => s.uid)).toEqual(['new@x']);
    expect(failingCache.putCount()).toBe(1);  // we did attempt the write
  });
});

// D1 overlay integration (loadAdminEventList → buildSuggestions) is intentionally not
// unit-tested here: loadAdminEventList chains through src/lib/get-db.ts which imports
// src/lib/env/env.service.ts, which has a top-level `await import('cloudflare:workers')`
// that vitest can't resolve in a Node environment. The overlay's ics_uid propagation is
// verified by: (a) this file's existing UID-match tests confirming buildSuggestions
// filters on any repoEvents.ics_uid; (b) the E2E spec which exercises the full flow
// through the real Astro preview server; (c) typecheck verifying the overlay signature
// returns `ics_uid` on the resulting AdminEvent. A production bug in the overlay would
// surface as "imported suggestion keeps reappearing after save" — visible in E2E.

describe('admin calendar suggestions — review-kind rows', () => {
  let h: ReturnType<typeof createTestDb>;
  let db: Database;
  let feedCache: ReturnType<typeof createInMemoryFeedCache>;
  beforeEach(() => {
    h = createTestDb();
    db = h.db as unknown as Database;
    feedCache = createInMemoryFeedCache();
  });
  afterEach(() => { h.cleanup(); });

  function fetcher(_url: string): Promise<ParsedFeed> {
    throw new Error('feed cache should serve from in-memory; fetcher must not be invoked');
  }

  test('matched VEVENT + non-empty diff → emits review-kind row', async () => {
    feedCache.seed('obc', 'http://feed', {
      fetched_at: new Date().toISOString(),
      source_url: 'http://feed',
      events: [{
        uid: 'u1', summary: 'Coffee Ride', start: '2026-06-20T18:00:00',
        location: 'Andrew Haydon Park',
      }],
    });
    await advanceSnapshot(db, 'ottawa', 'obc', 'u1', {
      uid: 'u1', summary: 'Coffee Ride', start: '2026-06-20T18:00:00',
      location: 'Britannia Park',
    }, '2026-06-20');

    const result = await buildSuggestions({
      db, city: 'ottawa',
      organizers: [{ slug: 'obc', name: 'OBC', ics_url: 'http://feed' }],
      repoEvents: [{
        id: 'evt-1', slug: 'coffee', year: '2026', name: 'Coffee Ride',
        start_date: '2026-06-20', ics_uid: 'u1', organizer: 'obc',
      } as any],
      feedCache, fetcher, siteTz: 'America/Toronto',
      now: new Date('2026-05-06T12:00:00Z'),
    });

    const review = result.find(s => s.kind === 'review');
    expect(review).toBeDefined();
    expect((review as any).uid).toBe('u1');
    expect((review as any).event_id).toBe('evt-1');
    expect((review as any).diff.master).toEqual([{
      field: 'location', mine: 'Britannia Park', upstream: 'Andrew Haydon Park',
    }]);
  });

  test('matched VEVENT + empty diff → no row', async () => {
    feedCache.seed('obc', 'http://feed', {
      fetched_at: new Date().toISOString(),
      source_url: 'http://feed',
      events: [{ uid: 'u1', summary: 'Coffee', start: '2026-06-20T18:00:00', location: 'A' }],
    });
    await advanceSnapshot(db, 'ottawa', 'obc', 'u1', {
      uid: 'u1', summary: 'Coffee', start: '2026-06-20T18:00:00', location: 'A',
    }, '2026-06-20');

    const result = await buildSuggestions({
      db, city: 'ottawa',
      organizers: [{ slug: 'obc', name: 'OBC', ics_url: 'http://feed' }],
      repoEvents: [{
        id: 'evt-1', slug: 'coffee', year: '2026', name: 'Coffee',
        start_date: '2026-06-20', ics_uid: 'u1', organizer: 'obc',
      } as any],
      feedCache, fetcher, siteTz: 'America/Toronto',
      now: new Date('2026-05-06T12:00:00Z'),
    });
    expect(result.find(s => s.kind === 'review')).toBeUndefined();
  });

  test('repo event ics_uid missing from upstream + future-dated → review row with eventRemoved', async () => {
    feedCache.seed('obc', 'http://feed', {
      fetched_at: new Date().toISOString(),
      source_url: 'http://feed',
      events: [],
    });
    await advanceSnapshot(db, 'ottawa', 'obc', 'gone-u', {
      uid: 'gone-u', summary: 'Spring Tour', start: '2026-06-20T18:00:00',
    }, '2026-06-20');

    const result = await buildSuggestions({
      db, city: 'ottawa',
      organizers: [{ slug: 'obc', name: 'OBC', ics_url: 'http://feed' }],
      repoEvents: [{
        id: 'evt-9', slug: 'spring', year: '2026', name: 'Spring Tour',
        start_date: '2026-06-20', ics_uid: 'gone-u', organizer: 'obc',
      } as any],
      feedCache, fetcher, siteTz: 'America/Toronto',
      now: new Date('2026-05-06T12:00:00Z'),
    });
    const review = result.find(s => s.kind === 'review');
    expect(review).toBeDefined();
    expect((review as any).diff.eventRemoved).toBe(true);
  });

  test('repo event ics_uid missing from upstream + past-dated → no row', async () => {
    feedCache.seed('obc', 'http://feed', {
      fetched_at: new Date().toISOString(),
      source_url: 'http://feed',
      events: [],
    });
    await advanceSnapshot(db, 'ottawa', 'obc', 'past-u', {
      uid: 'past-u', summary: 'Old Event', start: '2026-04-01T18:00:00',
    }, '2026-04-01');

    const result = await buildSuggestions({
      db, city: 'ottawa',
      organizers: [{ slug: 'obc', name: 'OBC', ics_url: 'http://feed' }],
      repoEvents: [{
        id: 'evt-old', slug: 'old', year: '2026', name: 'Old Event',
        start_date: '2026-04-01', ics_uid: 'past-u', organizer: 'obc',
      } as any],
      feedCache, fetcher, siteTz: 'America/Toronto',
      now: new Date('2026-05-06T12:00:00Z'),
    });
    expect(result.find(s => s.kind === 'review')).toBeUndefined();
  });

  test('bootstrap: matched VEVENT + no snapshot row → snapshot written, no row emitted', async () => {
    feedCache.seed('obc', 'http://feed', {
      fetched_at: new Date().toISOString(),
      source_url: 'http://feed',
      events: [{ uid: 'u1', summary: 'Coffee', start: '2026-06-20T18:00:00', location: 'A' }],
    });
    const result = await buildSuggestions({
      db, city: 'ottawa',
      organizers: [{ slug: 'obc', name: 'OBC', ics_url: 'http://feed' }],
      repoEvents: [{
        id: 'evt-1', slug: 'coffee', year: '2026', name: 'Coffee',
        start_date: '2026-06-20', ics_uid: 'u1', organizer: 'obc',
      } as any],
      feedCache, fetcher, siteTz: 'America/Toronto',
      now: new Date('2026-05-06T12:00:00Z'),
    });
    expect(result.find(s => s.kind === 'review')).toBeUndefined();
    const map = await loadAllSnapshots(db, 'ottawa', '2026-05-06');
    expect(map.has('obc:u1')).toBe(true);
  });
});

describe('toSuggestionItem — review-kind formatting', () => {
  const SITE_TZ = 'America/Toronto';
  const LOCALE = 'en';

  function reviewSugg(diff: UpdateDiff, over: Partial<ReviewSuggestion> = {}): ReviewSuggestion {
    return {
      kind: 'review',
      organizer_slug: 'obc',
      organizer_name: 'OBC',
      uid: 'u1',
      event_id: 'evt-1',
      name: 'Coffee Ride',
      start: '2026-06-20T18:00:00',
      diff,
      ...over,
    };
  }

  test('1 master field → "<field> changed · OBC"', () => {
    const diff: UpdateDiff = {
      master: [{ field: 'location', mine: 'A', upstream: 'B' }],
      occurrencesChanged: [], occurrencesAdded: [],
      occurrencesNewlyCancelled: [], occurrencesRemoved: [],
    };
    const item = toSuggestionItem(reviewSugg(diff), SITE_TZ, LOCALE);
    expect(item.meta).toBe('location changed · OBC');
  });

  test('multi master fields → "N fields changed · OBC"', () => {
    const diff: UpdateDiff = {
      master: [
        { field: 'location', mine: 'A', upstream: 'B' },
        { field: 'start', mine: 'X', upstream: 'Y' },
      ],
      occurrencesChanged: [], occurrencesAdded: [],
      occurrencesNewlyCancelled: [], occurrencesRemoved: [],
    };
    expect(toSuggestionItem(reviewSugg(diff), SITE_TZ, LOCALE).meta).toBe('2 fields changed · OBC');
  });

  test('only occurrence changes → "N occurrences updated · OBC"', () => {
    const diff: UpdateDiff = {
      master: [],
      occurrencesChanged: [
        { uid: 'a', date: '2026-07-08', fields: [] },
        { uid: 'b', date: '2026-07-15', fields: [] },
        { uid: 'c', date: '2026-07-22', fields: [] },
      ],
      occurrencesAdded: [], occurrencesNewlyCancelled: [], occurrencesRemoved: [],
    };
    expect(toSuggestionItem(reviewSugg(diff), SITE_TZ, LOCALE).meta).toBe('3 occurrences updated · OBC');
  });

  test('mixed master + addition → comma-separated parts · OBC', () => {
    const diff: UpdateDiff = {
      master: [
        { field: 'a', mine: '', upstream: '' },
        { field: 'b', mine: '', upstream: '' },
      ],
      occurrencesChanged: [],
      occurrencesAdded: [{ uid: 'new', date: '2026-08-05' } as any],
      occurrencesNewlyCancelled: [], occurrencesRemoved: [],
    };
    expect(toSuggestionItem(reviewSugg(diff), SITE_TZ, LOCALE).meta).toBe('2 fields changed, 1 new date · OBC');
  });

  test('one removal → "Removed <date> · OBC"', () => {
    const diff: UpdateDiff = {
      master: [], occurrencesChanged: [], occurrencesAdded: [],
      occurrencesNewlyCancelled: [],
      occurrencesRemoved: [{ uid: 'r', date: '2026-07-16' }],
    };
    const meta = toSuggestionItem(reviewSugg(diff), SITE_TZ, LOCALE).meta;
    expect(meta).toMatch(/^Removed /);
    expect(meta.endsWith('· OBC')).toBe(true);
  });

  test('eventRemoved → "Event removed · OBC"', () => {
    const diff: UpdateDiff = {
      master: [], occurrencesChanged: [], occurrencesAdded: [],
      occurrencesNewlyCancelled: [], occurrencesRemoved: [],
      eventRemoved: true,
    };
    expect(toSuggestionItem(reviewSugg(diff), SITE_TZ, LOCALE).meta).toBe('Event removed · OBC');
  });

  test('href points to /admin/events/<id>/review-update', () => {
    const diff: UpdateDiff = {
      master: [{ field: 'location', mine: 'A', upstream: 'B' }],
      occurrencesChanged: [], occurrencesAdded: [],
      occurrencesNewlyCancelled: [], occurrencesRemoved: [],
    };
    expect(toSuggestionItem(reviewSugg(diff, { event_id: 'evt-9' }), SITE_TZ, LOCALE).href)
      .toBe('/admin/events/evt-9/review-update');
  });

  test('dismissPayload has kind: review and event_id, no valid_until', () => {
    const diff: UpdateDiff = {
      master: [{ field: 'location', mine: 'A', upstream: 'B' }],
      occurrencesChanged: [], occurrencesAdded: [],
      occurrencesNewlyCancelled: [], occurrencesRemoved: [],
    };
    const item = toSuggestionItem(reviewSugg(diff), SITE_TZ, LOCALE);
    expect(item.dismissPayload).toEqual({
      kind: 'review',
      organizer_slug: 'obc',
      uid: 'u1',
      event_id: 'evt-1',
    });
  });

  test('import-kind dismissPayload now has kind: import', () => {
    const importSugg: ImportSuggestion = {
      kind: 'one-off', uid: 'u1',
      organizer_slug: 'obc', organizer_name: 'OBC',
      name: 'X', start: '2026-06-20T18:00:00',
      valid_until: '2026-06-20',
    };
    const item = toSuggestionItem(importSugg, SITE_TZ, LOCALE);
    expect(item.dismissPayload).toEqual({
      kind: 'import',
      organizer_slug: 'obc',
      uid: 'u1',
      valid_until: '2026-06-20',
    });
  });
});
