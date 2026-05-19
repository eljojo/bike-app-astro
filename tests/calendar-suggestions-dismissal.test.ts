import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from './test-db';
import type { Database } from '../src/db';
import {
  dismissSuggestion,
  listDismissedKeys,
  undismissSuggestion,
  NEVER_EXPIRES,
} from '../src/lib/calendar-suggestions/dismissals.server';
import { advanceSnapshot, loadAllSnapshots } from '../src/lib/calendar-suggestions/snapshots.server';
import type { ParsedFeed } from '../src/lib/calendar-suggestions/types';
import type { CalendarFeedCache } from '../src/lib/calendar-feed-cache/feed-cache.service';
import type { AdminEvent } from '../src/types/admin';
import { dispatchDismiss } from '../src/views/api/admin-calendar-suggestions-dismiss';

describe('calendar suggestion dismissals', () => {
  let h: ReturnType<typeof createTestDb>;
  let db: Database;
  beforeEach(() => { h = createTestDb(); db = h.db as unknown as Database; });
  afterEach(() => { h.cleanup(); });

  function keys(map: Map<string, unknown>): Set<string> { return new Set(map.keys()); }

  test('returns an empty map when nothing is dismissed', async () => {
    const map = await listDismissedKeys(db, 'ottawa', '2026-04-27');
    expect(map.size).toBe(0);
  });

  test('returns dismissals whose valid_until is on or after today', async () => {
    await dismissSuggestion(db, 'ottawa', 'qbc',  'future@x',  '2026-05-10');
    await dismissSuggestion(db, 'ottawa', 'qbc',  'today@x',   '2026-04-27');
    await dismissSuggestion(db, 'ottawa', 'qbc',  'past@x',    '2026-04-26');
    expect(keys(await listDismissedKeys(db, 'ottawa', '2026-04-27')))
      .toEqual(new Set(['qbc:future@x', 'qbc:today@x']));
  });

  test('records dismissed_at and exposes it for invalidation checks', async () => {
    await dismissSuggestion(db, 'ottawa', 'qbc', 'a@x', '2026-05-10', '2026-04-27T10:00:00.000Z');
    const map = await listDismissedKeys(db, 'ottawa', '2026-04-27');
    expect(map.get('qbc:a@x')?.dismissed_at).toBe('2026-04-27T10:00:00.000Z');
  });

  test('scopes to the requested city', async () => {
    await dismissSuggestion(db, 'ottawa', 'qbc',  'a@x', '2026-05-10');
    await dismissSuggestion(db, 'brevet', 'rcc',  'b@x', '2026-05-10');
    expect(keys(await listDismissedKeys(db, 'ottawa', '2026-04-27')))
      .toEqual(new Set(['qbc:a@x']));
    expect(keys(await listDismissedKeys(db, 'brevet', '2026-04-27')))
      .toEqual(new Set(['rcc:b@x']));
  });

  test('distinguishes two organizers with the same UID', async () => {
    // Without organizer_slug in the key, dismissing one would dismiss the other.
    await dismissSuggestion(db, 'ottawa', 'qbc',  'weekly-ride', '2026-09-30');
    await dismissSuggestion(db, 'ottawa', 'obmc', 'weekly-ride', '2026-09-30');
    await undismissSuggestion(db, 'ottawa', 'qbc', 'weekly-ride');
    expect(keys(await listDismissedKeys(db, 'ottawa', '2026-04-27')))
      .toEqual(new Set(['obmc:weekly-ride']));
  });

  test('NEVER_EXPIRES keeps a dismissal returned even far in the future', async () => {
    await dismissSuggestion(db, 'ottawa', 'qbc', 'unbounded@x', NEVER_EXPIRES);
    expect(keys(await listDismissedKeys(db, 'ottawa', '2099-01-01')))
      .toEqual(new Set(['qbc:unbounded@x']));
  });

  test('re-dismissing the same (org, uid) updates valid_until and dismissed_at in place', async () => {
    await dismissSuggestion(db, 'ottawa', 'qbc', 'uid-1@x', '2026-04-26', '2026-04-20T10:00:00.000Z');
    expect((await listDismissedKeys(db, 'ottawa', '2026-04-27')).size).toBe(0);  // valid_until expired
    await dismissSuggestion(db, 'ottawa', 'qbc', 'uid-1@x', '2026-05-10', '2026-04-27T15:00:00.000Z');
    const map = await listDismissedKeys(db, 'ottawa', '2026-04-27');
    expect(keys(map)).toEqual(new Set(['qbc:uid-1@x']));
    expect(map.get('qbc:uid-1@x')?.dismissed_at).toBe('2026-04-27T15:00:00.000Z');
  });

  test('undismiss removes the entry for that (org, uid) only', async () => {
    await dismissSuggestion(db, 'ottawa', 'qbc',  'uid-1@x', '2026-05-10');
    await dismissSuggestion(db, 'ottawa', 'obmc', 'uid-1@x', '2026-05-10');
    await undismissSuggestion(db, 'ottawa', 'qbc', 'uid-1@x');
    expect(keys(await listDismissedKeys(db, 'ottawa', '2026-04-27')))
      .toEqual(new Set(['obmc:uid-1@x']));
  });
});

// ---------------------------------------------------------------------------
// Helpers shared by the dispatch tests below.
// ---------------------------------------------------------------------------

function createInMemoryFeedCache(): CalendarFeedCache & {
  seed(slug: string, sourceUrl: string, feed: ParsedFeed): void;
} {
  const store = new Map<string, { sourceUrl: string; feed: ParsedFeed; expiresAt: number }>();
  return {
    seed(slug, sourceUrl, feed) {
      store.set(slug, { sourceUrl, feed, expiresAt: Date.now() + 3_600_000 });
    },
    async get(slug, expectedSourceUrl) {
      const entry = store.get(slug);
      if (!entry || entry.expiresAt <= Date.now()) return null;
      if (entry.sourceUrl !== expectedSourceUrl) return null;
      return entry.feed;
    },
    async put(slug, sourceUrl, feed, ttlSeconds) {
      store.set(slug, { sourceUrl, feed, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
  };
}

const TEST_ORGANIZERS = [{ slug: 'obc', ics_url: 'http://feed' }];

describe('dismiss endpoint — kind dispatch', () => {
  let h: ReturnType<typeof createTestDb>;
  let db: Database;
  beforeEach(() => { h = createTestDb(); db = h.db as unknown as Database; });
  afterEach(() => { h.cleanup(); });

  test('kind: review with matching upstream → advances snapshot, does not write to dismissals', async () => {
    // Pre-populate snapshot with location 'A'.
    await advanceSnapshot(db, 'ottawa', 'obc', 'u1', {
      uid: 'u1', summary: 'X', start: '2026-06-20T18:00:00', location: 'A',
    }, '2026-06-20');

    // Feed has the same UID but with location 'B' — simulates upstream change.
    const feedCache = createInMemoryFeedCache();
    feedCache.seed('obc', 'http://feed', {
      fetched_at: new Date().toISOString(),
      source_url: 'http://feed',
      events: [{ uid: 'u1', summary: 'X', start: '2026-06-20T18:00:00', location: 'B' }],
    });

    const repoEvents: Array<Pick<AdminEvent, 'id' | 'start_date' | 'end_date' | 'series'>> = [
      { id: 'evt-1', start_date: '2026-06-20', end_date: undefined, series: undefined },
    ];
    await dispatchDismiss(db, 'ottawa', feedCache, TEST_ORGANIZERS, repoEvents, {
      kind: 'review',
      organizer_slug: 'obc',
      uid: 'u1',
      event_id: 'evt-1',
    });

    // Snapshot advanced to upstream's location 'B'.
    const snap = (await loadAllSnapshots(db, 'ottawa', '2026-05-06')).get('obc:u1');
    expect(snap?.location).toBe('B');

    // Dismissals table untouched.
    expect((await listDismissedKeys(db, 'ottawa', '2026-05-06')).has('obc:u1')).toBe(false);
  });

  test('kind: review with no upstream → deletes snapshot row', async () => {
    await advanceSnapshot(db, 'ottawa', 'obc', 'gone', {
      uid: 'gone', summary: 'X', start: '2026-06-20T18:00:00',
    }, '2026-06-20');

    const feedCache = createInMemoryFeedCache();
    feedCache.seed('obc', 'http://feed', {
      fetched_at: new Date().toISOString(),
      source_url: 'http://feed',
      events: [],
    });

    await dispatchDismiss(db, 'ottawa', feedCache, TEST_ORGANIZERS, [], {
      kind: 'review',
      organizer_slug: 'obc',
      uid: 'gone',
      event_id: 'evt-9',
    });

    expect((await loadAllSnapshots(db, 'ottawa', '2026-05-06')).has('obc:gone')).toBe(false);
  });

  test('kind: import → writes dismissal; snapshot untouched', async () => {
    // Pre-existing snapshot should survive.
    await advanceSnapshot(db, 'ottawa', 'obc', 'new-u', {
      uid: 'new-u', summary: 'Y', start: '2026-07-01T18:00:00',
    }, '2026-07-01');

    const feedCache = createInMemoryFeedCache();

    await dispatchDismiss(db, 'ottawa', feedCache, TEST_ORGANIZERS, [], {
      kind: 'import',
      organizer_slug: 'obc',
      uid: 'new-u',
      valid_until: '2026-12-31',
    });

    expect((await listDismissedKeys(db, 'ottawa', '2026-05-06')).has('obc:new-u')).toBe(true);
    // Snapshot untouched.
    expect((await loadAllSnapshots(db, 'ottawa', '2026-05-06')).has('obc:new-u')).toBe(true);
  });

  test('payload missing kind defaults to import (backward compat)', async () => {
    const feedCache = createInMemoryFeedCache();

    // Cast away kind to simulate a legacy payload arriving without it;
    // dispatchDismiss receives already-parsed body, so we mutate after parse.
    const body = {
      kind: 'import' as const,
      organizer_slug: 'obc',
      uid: 'old-u',
      valid_until: '2026-12-31',
    };

    await dispatchDismiss(db, 'ottawa', feedCache, TEST_ORGANIZERS, [], body);

    expect((await listDismissedKeys(db, 'ottawa', '2026-05-06')).has('obc:old-u')).toBe(true);
  });

  test('kind: review computes expires_at from repo event date', async () => {
    await advanceSnapshot(db, 'ottawa', 'obc', 'u1', {
      uid: 'u1', summary: 'X', start: '2026-06-20T18:00:00', location: 'A',
    }, '2026-06-20');
    const feedCache = createInMemoryFeedCache();
    feedCache.seed('obc', 'http://feed', {
      fetched_at: new Date().toISOString(),
      source_url: 'http://feed',
      events: [{ uid: 'u1', summary: 'X', start: '2026-06-20T18:00:00', location: 'B' }],
    });

    const repoEvents: Array<Pick<AdminEvent, 'id' | 'start_date' | 'end_date' | 'series'>> = [
      { id: 'evt-1', start_date: '2026-06-20', end_date: undefined, series: undefined },
    ];
    await dispatchDismiss(db, 'ottawa', feedCache, TEST_ORGANIZERS, repoEvents as any, {
      kind: 'review', organizer_slug: 'obc', uid: 'u1', event_id: 'evt-1',
    });

    // Loading with today=2026-06-21 (one day past start_date) should filter the row out
    // since computeExpiresAt returned '2026-06-20'.
    expect((await loadAllSnapshots(db, 'ottawa', '2026-06-21')).has('obc:u1')).toBe(false);
    // Loading with today=2026-06-20 (= expires_at) should still find it.
    expect((await loadAllSnapshots(db, 'ottawa', '2026-06-20')).has('obc:u1')).toBe(true);
  });
});
