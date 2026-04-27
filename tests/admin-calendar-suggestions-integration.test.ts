/**
 * Integration coverage that the unit tests can't reach: the real
 * `loadAdminEventList → buildSuggestions` chain through `src/lib/get-db.ts`
 * and `src/lib/env/env.service.ts`.
 *
 * `tests/setup.ts` sets `process.env.RUNTIME = 'local'` so env.service takes
 * the local-adapter branch (the `cloudflare:workers` virtual module doesn't
 * resolve outside the Workers runtime). It also sets a per-worker
 * `LOCAL_DB_PATH` we can write to — env.service snapshots this at module
 * init, so we use that path here rather than `createTestDb()`.
 */
import { describe, test, expect, beforeAll, afterEach, afterAll } from 'vitest';
import fs from 'node:fs';
import { calendarSuggestionDismissals, contentEdits } from '../src/db/schema';
import type { ParsedFeed } from '../src/lib/calendar-suggestions/types';
import type { CalendarFeedCache } from '../src/lib/calendar-feed-cache/feed-cache.service';

function inMemoryFeedCache(seed: ParsedFeed | null): CalendarFeedCache {
  return {
    async get() { return seed; },
    async put() { /* no-op */ },
  };
}

const dbPath = process.env.LOCAL_DB_PATH!;

beforeAll(() => {
  // Wipe any stale test DB BEFORE env.service is imported. env.service runs
  // createLocalDb(LOCAL_DB_PATH) at module init, which calls initSchema; on a
  // pre-existing DB at a previous schema state, 0014's `DROP COLUMN
  // organizer_slug` fails because 0015 made it part of the PK. Starting from
  // a clean file means the migrations replay in order against an empty DB.
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + ext); } catch { /* ok */ }
  }
});

afterEach(async () => {
  // Use a fresh connection (matches production's per-call openLocalDb pattern)
  // and clear test-affected tables. Do NOT pre-import env.service in the file
  // header — keep the module graph evaluation inside the tests so beforeAll's
  // wipe runs first.
  const { db: getDb } = await import('../src/lib/get-db');
  const db = getDb();
  await db.delete(calendarSuggestionDismissals).run();
  await db.delete(contentEdits).run();
});

afterAll(() => {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + ext); } catch { /* best-effort */ }
  }
});

describe('admin calendar suggestions — integration via env.service', () => {
  test('loadAdminEventList → buildSuggestions: dismissed UID is filtered, single D1 query', async () => {
    const { loadAdminEventList } = await import('../src/lib/content/load-admin-content.server');
    const { buildSuggestions } = await import('../src/lib/calendar-suggestions/build.server');
    const { dismissSuggestion } = await import('../src/lib/calendar-suggestions/dismissals.server');
    const { db: getDb } = await import('../src/lib/get-db');

    const db = getDb();
    await dismissSuggestion(db, 'demo', 'qbc', 'gone@x');

    const feed: ParsedFeed = {
      fetched_at: new Date().toISOString(),
      source_url: 'https://example.com/feed.ics',
      events: [
        { uid: 'gone@x', summary: 'Hidden by dismissal', start: '2026-05-10T18:00:00' },
        { uid: 'shown@x', summary: 'Visible', start: '2026-05-17T18:00:00' },
      ],
    };

    // Empty repoEvents — exercises the overlay code path with no rows.
    const { events: repoEvents } = await loadAdminEventList([]);
    expect(repoEvents).toEqual([]);  // sanity: D1 cache empty

    const suggestions = await buildSuggestions({
      db, city: 'demo',
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents,
      feedCache: inMemoryFeedCache(feed),
      fetcher: async () => { throw new Error('cache should serve'); },
      siteTz: 'UTC',
      now: new Date('2026-04-21T00:00:00Z'),
    });

    expect(suggestions.map(s => s.uid)).toEqual(['shown@x']);
  });

  test('loadAdminEventList overlay hides UIDs that admin saved into D1 cache', async () => {
    // Simulate: admin imported a suggestion (creating an event in the D1 overlay
    // with `ics_uid` set). The next pageload must hide that suggestion even
    // though the underlying virtual module hasn't been rebuilt yet.
    const { loadAdminEventList } = await import('../src/lib/content/load-admin-content.server');
    const { buildSuggestions } = await import('../src/lib/calendar-suggestions/build.server');
    const { db: getDb } = await import('../src/lib/get-db');

    const db = getDb();
    // Match `eventDetailSchema` required-fields list (id, slug, year, name,
    // start_date, body). Missing any required field makes Zod parse fail and
    // the overlay silently swallows the row.
    const cachedEvent = JSON.stringify({
      id: '2026/imported',
      slug: 'imported',
      year: '2026',
      name: 'Imported',
      start_date: '2026-05-10',
      ics_uid: 'imported@x',
      organizer: 'qbc',
      body: '',
    });
    await db.insert(contentEdits).values({
      city: 'demo',
      contentType: 'events',
      contentSlug: '2026/imported',
      data: cachedEvent,
      githubSha: 'fake-sha',
      updatedAt: new Date().toISOString(),
    }).run();

    const feed: ParsedFeed = {
      fetched_at: new Date().toISOString(),
      source_url: 'https://example.com/feed.ics',
      events: [
        { uid: 'imported@x', summary: 'Already imported', start: '2026-05-10T18:00:00' },
        { uid: 'still-new@x', summary: 'Still a suggestion', start: '2026-05-17T18:00:00' },
      ],
    };

    const { events: repoEvents } = await loadAdminEventList([]);
    expect(repoEvents.find(e => e.id === '2026/imported')?.ics_uid).toBe('imported@x');

    const suggestions = await buildSuggestions({
      db, city: 'demo',
      organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
      repoEvents,
      feedCache: inMemoryFeedCache(feed),
      fetcher: async () => { throw new Error('cache should serve'); },
      siteTz: 'UTC',
      now: new Date('2026-04-21T00:00:00Z'),
    });

    expect(suggestions.map(s => s.uid)).toEqual(['still-new@x']);
  });
});
