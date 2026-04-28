/**
 * When an upstream ICS edits an event after a dismissal was recorded, the
 * dismissal should no longer hide the suggestion. Recognised by comparing the
 * VEVENT's last_modified to the dismissal's dismissed_at — strictly newer
 * upstream edits invalidate.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from './test-db';
import type { Database } from '../src/db';
import type { ParsedFeed, ParsedVEvent } from '../src/lib/calendar-suggestions/types';
import type { CalendarFeedCache } from '../src/lib/calendar-feed-cache/feed-cache.service';
import { buildSuggestions } from '../src/lib/calendar-suggestions/build.server';
import { dismissSuggestion } from '../src/lib/calendar-suggestions/dismissals.server';

function inMemoryFeedCache(seed: ParsedFeed | null): CalendarFeedCache {
  return {
    async get() { return seed; },
    async put() { /* no-op */ },
  };
}

function oneOffFeed(lastModified: string | undefined): ParsedFeed {
  const e: ParsedVEvent = {
    uid: 'evt-1',
    summary: 'Group ride',
    start: '2026-05-15T18:00:00',
    location: 'Somewhere',
    last_modified: lastModified,
  };
  return {
    fetched_at: new Date().toISOString(),
    source_url: 'https://example.com/feed.ics',
    events: [e],
  };
}

describe('buildSuggestions — dismissal invalidated by upstream ICS edits', () => {
  let h: ReturnType<typeof createTestDb>;
  let db: Database;
  beforeEach(() => { h = createTestDb(); db = h.db as unknown as Database; });
  afterEach(() => { h.cleanup(); });

  const baseArgs = (feed: ParsedFeed) => ({
    db, city: 'ottawa',
    organizers: [{ slug: 'qbc', name: 'QBC', ics_url: 'https://example.com/feed.ics' }],
    repoEvents: [],
    feedCache: inMemoryFeedCache(feed),
    fetcher: async () => { throw new Error('cache should serve'); },
    siteTz: 'America/Toronto',
    now: new Date('2026-04-30T00:00:00Z'),
  });

  test('dismissal hides the suggestion when no upstream edit has happened since', async () => {
    const feed = oneOffFeed('2026-04-25T12:00:00.000Z');
    await dismissSuggestion(db, 'ottawa', 'qbc', 'evt-1', '2026-05-15', '2026-04-26T09:00:00.000Z');
    const suggestions = await buildSuggestions(baseArgs(feed));
    expect(suggestions).toEqual([]);
  });

  test('upstream LAST-MODIFIED bump after dismissal re-surfaces the suggestion', async () => {
    const feed = oneOffFeed('2026-04-29T12:00:00.000Z');
    await dismissSuggestion(db, 'ottawa', 'qbc', 'evt-1', '2026-05-15', '2026-04-26T09:00:00.000Z');
    const suggestions = await buildSuggestions(baseArgs(feed));
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].uid).toBe('evt-1');
  });

  test('redismissing after the upstream edit refreshes dismissed_at and hides it again', async () => {
    const feed = oneOffFeed('2026-04-29T12:00:00.000Z');
    // First dismissal — older than the upstream edit, so the suggestion would re-surface.
    await dismissSuggestion(db, 'ottawa', 'qbc', 'evt-1', '2026-05-15', '2026-04-26T09:00:00.000Z');
    // Re-dismiss after the upstream edit.
    await dismissSuggestion(db, 'ottawa', 'qbc', 'evt-1', '2026-05-15', '2026-04-29T13:00:00.000Z');
    const suggestions = await buildSuggestions(baseArgs(feed));
    expect(suggestions).toEqual([]);
  });

  test('feed without last_modified keeps the dismissal in force (no comparison signal)', async () => {
    const feed = oneOffFeed(undefined);
    await dismissSuggestion(db, 'ottawa', 'qbc', 'evt-1', '2026-05-15', '2026-04-26T09:00:00.000Z');
    const suggestions = await buildSuggestions(baseArgs(feed));
    expect(suggestions).toEqual([]);
  });
});
