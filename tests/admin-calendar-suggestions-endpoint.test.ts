import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from './test-db';
import type { Database } from '../src/db';
import { dismissSuggestion, writeCachedFeed } from '../src/lib/calendar-suggestions/cache.server';
import type { ParsedFeed, ParsedVEvent } from '../src/lib/calendar-suggestions/types';
import { buildSuggestions } from '../src/lib/calendar-suggestions/build.server';

describe('admin calendar suggestions — build logic', () => {
  let h: ReturnType<typeof createTestDb>;
  let db: Database;
  beforeEach(() => { h = createTestDb(); db = h.db as unknown as Database; });
  afterEach(() => { h.cleanup(); });

  function oneOff(uid: string, start: string, summary = 'Ride'): ParsedVEvent {
    return { uid, summary, start };
  }

  async function seedFeed(slug: string, events: ParsedVEvent[], sourceUrl = 'https://example.com/feed.ics') {
    const feed: ParsedFeed = {
      fetched_at: new Date().toISOString(),
      source_url: sourceUrl,
      events,
    };
    await writeCachedFeed(db, slug, sourceUrl, feed);
  }

  const cacheOnlyFetcher = async () => { throw new Error('cache should serve'); };

  test('hides UIDs that already appear on repo events', async () => {
    await seedFeed('qbc', [
      oneOff('already-in-repo@x', '2026-05-01T18:00:00.000Z'),
      oneOff('new@x', '2026-05-08T18:00:00.000Z'),
    ]);
    const suggestions = await buildSuggestions({
      db, city: 'ottawa',
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents: [{ id: '2026/a', slug: 'a', year: '2026', name: 'Existing', start_date: '2026-05-01', ics_uid: 'already-in-repo@x', organizer: 'qbc' }],
      fetcher: cacheOnlyFetcher,
      now: new Date('2026-04-21T00:00:00Z'),
    });
    expect(suggestions.map(s => s.uid)).toEqual(['new@x']);
  });

  test('hides UIDs that are dismissed', async () => {
    await seedFeed('qbc', [
      oneOff('dismissed@x', '2026-05-01T18:00:00.000Z'),
      oneOff('keep@x', '2026-05-08T18:00:00.000Z'),
    ]);
    await dismissSuggestion(db, 'ottawa', 'dismissed@x', 'qbc', 'admin-1');
    const suggestions = await buildSuggestions({
      db, city: 'ottawa',
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents: [],
      fetcher: cacheOnlyFetcher,
      now: new Date('2026-04-21T00:00:00Z'),
    });
    expect(suggestions.map(s => s.uid)).toEqual(['keep@x']);
  });

  test('hides one-off when same-organizer event exists on the same start_date', async () => {
    await seedFeed('qbc', [
      oneOff('no-uid-match@x', '2026-05-10T18:00:00.000Z'),
      oneOff('keep@x', '2026-05-17T18:00:00.000Z'),
    ]);
    const suggestions = await buildSuggestions({
      db, city: 'ottawa',
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents: [{ id: '2026/manual', slug: 'manual', year: '2026', name: 'Manually Added', start_date: '2026-05-10', organizer: 'qbc' }],
      fetcher: cacheOnlyFetcher,
      now: new Date('2026-04-21T00:00:00Z'),
    });
    expect(suggestions.map(s => s.uid)).toEqual(['keep@x']);
  });

  test('does NOT hide one-off when same date but different organizer', async () => {
    await seedFeed('qbc', [oneOff('keep@x', '2026-05-10T18:00:00.000Z')]);
    const suggestions = await buildSuggestions({
      db, city: 'ottawa',
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents: [{ id: '2026/other', slug: 'other', year: '2026', name: 'Other', start_date: '2026-05-10', organizer: 'obmc' }],
      fetcher: cacheOnlyFetcher,
      now: new Date('2026-04-21T00:00:00Z'),
    });
    expect(suggestions.map(s => s.uid)).toEqual(['keep@x']);
  });

  test('does NOT hide a series by organizer+date match (season_start coincidence)', async () => {
    await seedFeed('qbc', [{
      uid: 'series@x', summary: 'Every Monday', start: '2026-05-10T18:00:00.000Z',
      series: { kind: 'recurrence', recurrence: 'weekly', recurrence_day: 'monday', season_start: '2026-05-10', season_end: '2026-09-07' },
    }]);
    const suggestions = await buildSuggestions({
      db, city: 'ottawa',
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents: [{ id: '2026/manual', slug: 'manual', year: '2026', name: 'Coincidental', start_date: '2026-05-10', organizer: 'qbc' }],
      fetcher: cacheOnlyFetcher,
      now: new Date('2026-04-21T00:00:00Z'),
    });
    expect(suggestions.map(s => s.uid)).toEqual(['series@x']);
  });

  test('respects the 180-day horizon', async () => {
    await seedFeed('qbc', [
      oneOff('soon@x', '2026-05-01T18:00:00.000Z'),
      oneOff('far@x', '2027-06-01T18:00:00.000Z'),
    ]);
    const suggestions = await buildSuggestions({
      db, city: 'ottawa',
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents: [],
      fetcher: cacheOnlyFetcher,
      now: new Date('2026-04-21T00:00:00Z'),
    });
    expect(suggestions.map(s => s.uid)).toEqual(['soon@x']);
  });

  test('caps at 10 items sorted by start', async () => {
    await seedFeed('qbc', Array.from({ length: 15 }, (_, i) =>
      oneOff(`e${i}@x`, `2026-05-${String(i + 1).padStart(2, '0')}T18:00:00.000Z`)));
    const suggestions = await buildSuggestions({
      db, city: 'ottawa',
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents: [],
      fetcher: cacheOnlyFetcher,
      now: new Date('2026-04-21T00:00:00Z'),
    });
    expect(suggestions).toHaveLength(10);
    expect(suggestions[0].uid).toBe('e0@x');
    expect(suggestions[9].uid).toBe('e9@x');
  });

  test('isolates failure per feed — one bad feed does not block others', async () => {
    await seedFeed('good', [oneOff('good@x', '2026-05-01T18:00:00.000Z')], 'https://example.com/good.ics');
    // 'bad' has no cached entry; fetcher throws for that slug.
    const suggestions = await buildSuggestions({
      db, city: 'ottawa',
      organizers: [
        { slug: 'good', name: 'Good', ics_url: 'https://example.com/good.ics' },
        { slug: 'bad', name: 'Bad', ics_url: 'https://example.com/bad.ics' },
      ],
      repoEvents: [],
      fetcher: async (url) => {
        if (url.includes('bad')) throw new Error('network error');
        throw new Error('good feed should hit cache');
      },
      now: new Date('2026-04-21T00:00:00Z'),
    });
    expect(suggestions.map(s => s.uid)).toEqual(['good@x']);
  });

  test('excludes one-off events that have already ended (past events)', async () => {
    await seedFeed('qbc', [
      oneOff('past@x', '2026-03-01T18:00:00.000Z'),    // before now=2026-04-21
      oneOff('future@x', '2026-05-01T18:00:00.000Z'),
    ]);
    const suggestions = await buildSuggestions({
      db, city: 'ottawa',
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents: [],
      fetcher: cacheOnlyFetcher,
      now: new Date('2026-04-21T00:00:00Z'),
    });
    expect(suggestions.map(s => s.uid)).toEqual(['future@x']);
  });

  test('excludes recurrence series whose season_end has already passed', async () => {
    await seedFeed('qbc', [
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
      db, city: 'ottawa',
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents: [],
      fetcher: cacheOnlyFetcher,
      now: new Date('2026-04-21T00:00:00Z'),
    });
    expect(suggestions.map(s => s.uid)).toEqual(['ongoing@x']);
  });

  test('treats a cache row from a different source URL as stale', async () => {
    await seedFeed('qbc', [oneOff('old-feed@x', '2026-05-01T18:00:00.000Z')]);
    let fetchCount = 0;
    const suggestions = await buildSuggestions({
      db, city: 'ottawa',
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
      now: new Date('2026-04-21T00:00:00Z'),
    });
    expect(fetchCount).toBe(1);
    expect(suggestions.map(s => s.uid)).toEqual(['new-feed@x']);
  });
});
