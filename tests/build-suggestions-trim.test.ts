/**
 * Coverage for the partial-import dedupe path in buildSuggestions: when a
 * cluster's per-occurrence override UIDs overlap the repo, the cluster gets
 * trimmed (and either re-emitted as a smaller series or dissolved into
 * one-offs). This file uses hand-built `repoEvents` + an in-memory feed cache
 * so it doesn't touch CITY-dependent code paths.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from './test-db';
import type { Database } from '../src/db';
import type { ParsedFeed, ParsedVEvent } from '../src/lib/calendar-suggestions/types';
import type { CalendarFeedCache } from '../src/lib/calendar-feed-cache/feed-cache.service';
import type { AdminEvent } from '../src/types/admin';
import { buildSuggestions } from '../src/lib/calendar-suggestions/build.server';

function inMemoryFeedCache(seed: ParsedFeed | null): CalendarFeedCache {
  return {
    async get() { return seed; },
    async put() { /* no-op */ },
  };
}

/** A weekly-Wednesday cluster of 8 occurrences across May–June 2026, every
 *  occurrence emitting a meaningful override (its uid carried via event_url). */
function weeklyClusterFeed(): ParsedFeed {
  const cluster: ParsedVEvent = {
    uid: 'a',
    summary: 'Wednesday Coffee Ride',
    start: '2026-05-06T10:00:00',
    series: {
      kind: 'recurrence',
      recurrence: 'weekly',
      recurrence_day: 'wednesday',
      season_start: '2026-05-06',
      season_end: '2026-06-24',
      overrides: [
        { date: '2026-05-06', uid: 'a' },
        { date: '2026-05-13', uid: 'b' },
        { date: '2026-05-20', uid: 'c' },
        { date: '2026-05-27', uid: 'd' },
        { date: '2026-06-03', uid: 'e' },
        { date: '2026-06-10', uid: 'f' },
        { date: '2026-06-17', uid: 'g' },
        { date: '2026-06-24', uid: 'h' },
      ],
    },
  };
  return {
    fetched_at: new Date().toISOString(),
    source_url: 'https://example.com/feed.ics',
    events: [cluster],
  };
}

function buildAdminEvent(overrides: Partial<AdminEvent>): AdminEvent {
  return {
    id: '2026/test',
    slug: 'test',
    year: '2026',
    name: 'Test',
    start_date: '2026-05-06',
    hasBody: true,
    mediaCount: 0,
    waypointCount: 0,
    contentHash: '',
    ...overrides,
  };
}

describe('buildSuggestions — partial-import dedupe (Task 8)', () => {
  let h: ReturnType<typeof createTestDb>;
  let db: Database;
  beforeEach(() => { h = createTestDb(); db = h.db as unknown as Database; });
  afterEach(() => { h.cleanup(); });

  test('emits the full series when nothing in repo overlaps', async () => {
    const suggestions = await buildSuggestions({
      db, city: 'ottawa',
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents: [],
      feedCache: inMemoryFeedCache(weeklyClusterFeed()),
      fetcher: async () => { throw new Error('cache should serve'); },
      siteTz: 'America/Toronto',
      now: new Date('2026-04-30T00:00:00Z'),
    });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].kind).toBe('series');
    expect(suggestions[0].uid).toBe('a');
  });

  test('hides the cluster entirely when the repo already covers all 8 occurrence UIDs', async () => {
    // Imported series carries every UID via per-occurrence overrides.
    const importedSeries = buildAdminEvent({
      id: '2026/wed-coffee',
      slug: 'wed-coffee',
      ics_uid: 'a',
      organizer: 'qbc',
      series: {
        recurrence: 'weekly',
        recurrence_day: 'wednesday',
        season_start: '2026-05-06',
        season_end: '2026-06-24',
        overrides: [
          { date: '2026-05-06', uid: 'a' },
          { date: '2026-05-13', uid: 'b' },
          { date: '2026-05-20', uid: 'c' },
          { date: '2026-05-27', uid: 'd' },
          { date: '2026-06-03', uid: 'e' },
          { date: '2026-06-10', uid: 'f' },
          { date: '2026-06-17', uid: 'g' },
          { date: '2026-06-24', uid: 'h' },
        ],
      },
    });
    const suggestions = await buildSuggestions({
      db, city: 'ottawa',
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents: [importedSeries],
      feedCache: inMemoryFeedCache(weeklyClusterFeed()),
      fetcher: async () => { throw new Error('cache should serve'); },
      siteTz: 'America/Toronto',
      now: new Date('2026-04-30T00:00:00Z'),
    });
    // isAlreadyInRepo short-circuits on top-level uid 'a'.
    expect(suggestions).toEqual([]);
  });

  test('emits a trimmed series when the repo only covers some occurrence UIDs (every other → biweekly)', async () => {
    // Imported event has uids a,c,e,g (every other Wednesday). The feed
    // cluster's top-level uid is 'a', so isAlreadyInRepo would short-circuit
    // and dedupe the whole cluster. To exercise the trim path we set the
    // repo's top-level ics_uid to a placeholder NOT matching the feed's top
    // uid; only the override list overlaps.
    const importedSeries = buildAdminEvent({
      id: '2026/wed-coffee',
      slug: 'wed-coffee',
      ics_uid: 'unrelated-top-uid',
      organizer: 'qbc',
      series: {
        recurrence: 'biweekly',
        recurrence_day: 'wednesday',
        season_start: '2026-05-06',
        season_end: '2026-06-17',
        overrides: [
          { date: '2026-05-06', uid: 'a' },
          { date: '2026-05-20', uid: 'c' },
          { date: '2026-06-03', uid: 'e' },
          { date: '2026-06-17', uid: 'g' },
        ],
      },
    });
    const suggestions = await buildSuggestions({
      db, city: 'ottawa',
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents: [importedSeries],
      feedCache: inMemoryFeedCache(weeklyClusterFeed()),
      fetcher: async () => { throw new Error('cache should serve'); },
      siteTz: 'America/Toronto',
      now: new Date('2026-04-30T00:00:00Z'),
    });
    // Survivors: b, d, f, h — biweekly cluster.
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].kind).toBe('series');
    expect(suggestions[0].name).toBe('Wednesday Coffee Ride');
    expect(suggestions[0].uid).toBe('a');  // master uid preserved (master not removed)
    expect(suggestions[0].series_label).toBe('Every other Wednesday');
  });

  test('dissolves to one-offs when trimmed cluster falls below MIN_CLUSTER_SIZE', async () => {
    // Imported event covers 6 of 8 (a,b,c,d,e,f). Survivors g+h = 2 → below
    // size threshold → cluster dissolves; surviving overrides surface as
    // one-offs.
    const importedSeries = buildAdminEvent({
      id: '2026/wed-coffee',
      slug: 'wed-coffee',
      ics_uid: 'unrelated-top-uid',
      organizer: 'qbc',
      series: {
        recurrence: 'weekly',
        recurrence_day: 'wednesday',
        season_start: '2026-05-06',
        season_end: '2026-06-10',
        overrides: [
          { date: '2026-05-06', uid: 'a' },
          { date: '2026-05-13', uid: 'b' },
          { date: '2026-05-20', uid: 'c' },
          { date: '2026-05-27', uid: 'd' },
          { date: '2026-06-03', uid: 'e' },
          { date: '2026-06-10', uid: 'f' },
        ],
      },
    });
    const suggestions = await buildSuggestions({
      db, city: 'ottawa',
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents: [importedSeries],
      feedCache: inMemoryFeedCache(weeklyClusterFeed()),
      fetcher: async () => { throw new Error('cache should serve'); },
      siteTz: 'America/Toronto',
      now: new Date('2026-04-30T00:00:00Z'),
    });
    expect(suggestions).toHaveLength(2);
    expect(suggestions.every(s => s.kind === 'one-off')).toBe(true);
    expect(suggestions.map(s => s.uid).sort()).toEqual(['g', 'h']);
  });
});
