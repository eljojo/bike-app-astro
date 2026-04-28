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

  test('hides one-off suggestions whose UID is on the repo series.schedule (not just overrides)', async () => {
    // Repro for the Bushtukah workshop bug: the upstream feed emits each
    // occurrence as a separate one-off VEVENT (Tockify-style — no RRULE).
    // The repo carries them under series.schedule with their UIDs. Without
    // schedule-UID dedupe the second occurrence re-suggests as a one-off and
    // the admin creates a duplicate event file.
    const importedSeries = buildAdminEvent({
      id: '2026/flat-repair-workshop',
      slug: 'flat-repair-workshop',
      ics_uid: 'tkf-493',
      organizer: 'bushtukah',
      series: {
        schedule: [
          { date: '2026-05-07', uid: 'tkf-493' },
          { date: '2026-06-04', uid: 'tkf-494' },
        ],
      },
    });
    const oneOffsFeed: ParsedFeed = {
      fetched_at: new Date().toISOString(),
      source_url: 'https://example.com/feed.ics',
      events: [
        { uid: 'tkf-493', summary: 'Flat Repair Workshop', start: '2026-05-07T17:30:00' },
        { uid: 'tkf-494', summary: 'Flat Repair Workshop', start: '2026-06-04T17:30:00' },
      ],
    };
    const suggestions = await buildSuggestions({
      db, city: 'ottawa',
      organizers: [{ slug: 'bushtukah', name: 'Bushtukah', ics_url: 'https://example.com/feed.ics' }],
      repoEvents: [importedSeries],
      feedCache: inMemoryFeedCache(oneOffsFeed),
      fetcher: async () => { throw new Error('cache should serve'); },
      siteTz: 'America/Toronto',
      now: new Date('2026-04-30T00:00:00Z'),
    });
    // Both occurrences are already represented by the schedule series; neither
    // should re-surface as a suggestion.
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
    // The original master uid 'a' was removed from the surviving set, so the
    // trimmed cluster adopts the first surviving real occurrence's uid (b).
    // Keeping 'a' would create an ics_uid collision with the already-imported
    // event in the repo.
    expect(suggestions[0].uid).toBe('b');
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

  // -------------------------------------------------------------------------
  // Codex-found bug reproductions
  // -------------------------------------------------------------------------

  test('cluster with one divergent occurrence dissolves to one-offs for the rest', async () => {
    // After the parser fix, every cluster carries a per-occurrence override
    // row (with at least date+uid) so partial-import dedupe finds every
    // source UID. Here only b carries a divergent field, but a, c, d still
    // appear in overrides[] with date+uid only. With b imported, trim
    // produces 3 surviving one-offs for a, c, d.
    const cluster: ParsedVEvent = {
      uid: 'a',
      summary: 'Sparse Cluster',
      start: '2026-05-06T10:00:00',
      series: {
        kind: 'recurrence',
        recurrence: 'weekly',
        recurrence_day: 'wednesday',
        season_start: '2026-05-06',
        season_end: '2026-05-27',
        overrides: [
          { date: '2026-05-06', uid: 'a' },
          { date: '2026-05-13', uid: 'b', location: 'OVERRIDE_PLACE' },
          { date: '2026-05-20', uid: 'c' },
          { date: '2026-05-27', uid: 'd' },
        ],
      },
    };
    const importedB = buildAdminEvent({
      id: '2026/imported-b',
      ics_uid: 'b',
    });
    const suggestions = await buildSuggestions({
      db, city: 'ottawa',
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents: [importedB],
      feedCache: inMemoryFeedCache({
        fetched_at: new Date().toISOString(),
        source_url: 'https://example.com/feed.ics',
        events: [cluster],
      }),
      fetcher: async () => { throw new Error('cache should serve'); },
      siteTz: 'America/Toronto',
      now: new Date('2026-04-30T00:00:00Z'),
    });
    // a (master), c, d should each surface as a one-off after the cluster
    // dissolves below MIN_CLUSTER_SIZE.
    expect(suggestions.map(s => s.uid).sort()).toEqual(['a', 'c', 'd']);
  });

  test('clean cluster with all UIDs in overrides dedupes already-imported occurrences', async () => {
    // After the parser fix, even a "clean" cluster (no diverging fields)
    // emits one override row per occurrence carrying date+uid. With b and c
    // imported, trim produces 2 surviving one-offs for a and d.
    const cleanCluster: ParsedVEvent = {
      uid: 'a',
      summary: 'Clean Cluster',
      start: '2026-05-06T10:00:00',
      series: {
        kind: 'recurrence',
        recurrence: 'weekly',
        recurrence_day: 'wednesday',
        season_start: '2026-05-06',
        season_end: '2026-05-27',
        overrides: [
          { date: '2026-05-06', uid: 'a' },
          { date: '2026-05-13', uid: 'b' },
          { date: '2026-05-20', uid: 'c' },
          { date: '2026-05-27', uid: 'd' },
        ],
      },
    };
    const importedB = buildAdminEvent({ id: '2026/imp-b', ics_uid: 'b' });
    const importedC = buildAdminEvent({ id: '2026/imp-c', ics_uid: 'c' });
    const suggestions = await buildSuggestions({
      db, city: 'ottawa',
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents: [importedB, importedC],
      feedCache: inMemoryFeedCache({
        fetched_at: new Date().toISOString(),
        source_url: 'https://example.com/feed.ics',
        events: [cleanCluster],
      }),
      fetcher: async () => { throw new Error('cache should serve'); },
      siteTz: 'America/Toronto',
      now: new Date('2026-04-30T00:00:00Z'),
    });
    // Only a and d should remain — b and c were imported.
    // The cluster has 4 occurrences; trimmed to 2 it falls below
    // MIN_CLUSTER_SIZE and dissolves into 2 one-offs.
    expect(suggestions.map(s => s.uid).sort()).toEqual(['a', 'd']);
  });

  test('BUG: dissolve emits cancelled-skip rows as one-off suggestions', async () => {
    // Cluster with one cancelled-skip row (5/20, no uid) plus 4 real
    // occurrences. Repo has a, b, c imported. Trim should leave one
    // surviving real occurrence (d). The cancelled-skip row must NOT be
    // emitted as a one-off suggestion — it represents a missed week,
    // not a ride to import.
    const cluster: ParsedVEvent = {
      uid: 'a',
      summary: 'Cluster With Skip',
      start: '2026-05-06T10:00:00',
      series: {
        kind: 'recurrence',
        recurrence: 'weekly',
        recurrence_day: 'wednesday',
        season_start: '2026-05-06',
        season_end: '2026-06-03',
        overrides: [
          { date: '2026-05-06', uid: 'a' },
          { date: '2026-05-13', uid: 'b' },
          { date: '2026-05-20', cancelled: true },
          { date: '2026-05-27', uid: 'c' },
          { date: '2026-06-03', uid: 'd' },
        ],
      },
    };
    const importedA = buildAdminEvent({ id: '2026/imp-a', ics_uid: 'a' });
    const importedB = buildAdminEvent({ id: '2026/imp-b', ics_uid: 'b' });
    const importedC = buildAdminEvent({ id: '2026/imp-c', ics_uid: 'c' });
    const suggestions = await buildSuggestions({
      db, city: 'ottawa',
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents: [importedA, importedB, importedC],
      feedCache: inMemoryFeedCache({
        fetched_at: new Date().toISOString(),
        source_url: 'https://example.com/feed.ics',
        events: [cluster],
      }),
      fetcher: async () => { throw new Error('cache should serve'); },
      siteTz: 'America/Toronto',
      now: new Date('2026-04-30T00:00:00Z'),
    });
    // Only d should survive; the cancelled-skip row is not a real occurrence.
    expect(suggestions.map(s => s.uid)).toEqual(['d']);
  });
});
