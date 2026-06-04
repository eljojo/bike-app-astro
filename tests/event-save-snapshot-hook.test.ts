import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from './test-db';
import type { Database } from '../src/db';
import { maybeAdvanceSnapshotForSavedEvent } from '../src/views/api/event-save';
import { loadAllSnapshots } from '../src/lib/calendar-suggestions/snapshots.server';
import type { ParsedFeed } from '../src/lib/calendar-suggestions/types';

function inMemoryFeedCache() {
  const store = new Map<string, ParsedFeed>();
  return {
    seed(slug: string, _url: string, feed: ParsedFeed) { store.set(slug, feed); },
    async get(slug: string, _url: string) { return store.get(slug) ?? null; },
    async put() { /* no-op */ },
  };
}

describe('event-save — snapshot advance hook', () => {
  let h: ReturnType<typeof createTestDb>;
  let db: Database;
  beforeEach(() => { h = createTestDb(); db = h.db as unknown as Database; });
  afterEach(() => { h.cleanup(); });

  test('saving an event with ics_uid + matching upstream → snapshot is advanced', async () => {
    const cache = inMemoryFeedCache();
    cache.seed('obc', 'http://feed', {
      fetched_at: new Date().toISOString(),
      source_url: 'http://feed',
      events: [{ uid: 'u1', summary: 'Coffee', start: '2026-06-20T18:00:00', location: 'Britannia' }],
    });
    await maybeAdvanceSnapshotForSavedEvent(db, 'ottawa',
      { id: 'evt-1', ics_uid: 'u1', organizer: 'obc', start_date: '2026-06-20' } as any,
      cache as any,
      [{ slug: 'obc', name: 'OBC', ics_url: 'http://feed' }] as any,
    );
    const map = await loadAllSnapshots(db, 'ottawa', '2026-05-06');
    expect(map.get('obc:u1')?.location).toBe('Britannia');
  });

  test('saving an event without ics_uid → no snapshot written', async () => {
    const cache = inMemoryFeedCache();
    await maybeAdvanceSnapshotForSavedEvent(db, 'ottawa',
      { id: 'evt-1', organizer: 'obc', start_date: '2026-06-20' } as any,
      cache as any,
      [{ slug: 'obc', name: 'OBC', ics_url: 'http://feed' }] as any,
    );
    expect((await loadAllSnapshots(db, 'ottawa', '2026-05-06')).size).toBe(0);
  });

  test('saving an event with ics_uid but no matching upstream → no snapshot written', async () => {
    const cache = inMemoryFeedCache();
    cache.seed('obc', 'http://feed', {
      fetched_at: new Date().toISOString(),
      source_url: 'http://feed',
      events: [],     // empty
    });
    await maybeAdvanceSnapshotForSavedEvent(db, 'ottawa',
      { id: 'evt-1', ics_uid: 'u1', organizer: 'obc', start_date: '2026-06-20' } as any,
      cache as any,
      [{ slug: 'obc', name: 'OBC', ics_url: 'http://feed' }] as any,
    );
    expect((await loadAllSnapshots(db, 'ottawa', '2026-05-06')).size).toBe(0);
  });

  test('saving an event whose organizer has no ics_url → no snapshot, no error', async () => {
    const cache = inMemoryFeedCache();
    await maybeAdvanceSnapshotForSavedEvent(db, 'ottawa',
      { id: 'evt-1', ics_uid: 'u1', organizer: 'unknown', start_date: '2026-06-20' } as any,
      cache as any,
      [{ slug: 'obc', name: 'OBC', ics_url: 'http://feed' }] as any,
    );
    expect((await loadAllSnapshots(db, 'ottawa', '2026-05-06')).size).toBe(0);
  });
});
