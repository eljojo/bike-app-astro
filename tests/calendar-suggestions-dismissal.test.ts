import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from './test-db';
import type { Database } from '../src/db';
import {
  dismissSuggestion,
  listDismissedUids,
  undismissSuggestion,
} from '../src/lib/calendar-suggestions/cache.server';

describe('calendar suggestion dismissals', () => {
  let h: ReturnType<typeof createTestDb>;
  let db: Database;
  beforeEach(() => { h = createTestDb(); db = h.db as unknown as Database; });
  afterEach(() => { h.cleanup(); });

  test('listDismissedUids returns an empty set by default', async () => {
    expect(await listDismissedUids(db, 'ottawa')).toEqual(new Set());
  });

  test('dismiss then list round-trips per city', async () => {
    await dismissSuggestion(db, 'ottawa', 'uid-1@x', 'qbc', 'user-a');
    await dismissSuggestion(db, 'ottawa', 'uid-2@x', 'qbc', 'user-a');
    await dismissSuggestion(db, 'brevet', 'uid-3@x', 'obmc', 'user-a');
    expect(await listDismissedUids(db, 'ottawa')).toEqual(new Set(['uid-1@x', 'uid-2@x']));
    expect(await listDismissedUids(db, 'brevet')).toEqual(new Set(['uid-3@x']));
  });

  test('re-dismissing the same UID is idempotent', async () => {
    await dismissSuggestion(db, 'ottawa', 'uid-1@x', 'qbc', 'user-a');
    await dismissSuggestion(db, 'ottawa', 'uid-1@x', 'qbc', 'user-a');
    expect((await listDismissedUids(db, 'ottawa')).size).toBe(1);
  });

  test('undismiss removes the entry', async () => {
    await dismissSuggestion(db, 'ottawa', 'uid-1@x', 'qbc', 'user-a');
    await undismissSuggestion(db, 'ottawa', 'uid-1@x');
    expect(await listDismissedUids(db, 'ottawa')).toEqual(new Set());
  });

  test('event snapshot is stored when provided', async () => {
    await dismissSuggestion(db, 'ottawa', 'uid-1@x', 'qbc', 'user-a', { name: 'Ride A', start: '2026-05-10' });
    const { calendarSuggestionDismissals } = await import('../src/db/schema');
    const { eq, and } = await import('drizzle-orm');
    const rows = await db.select().from(calendarSuggestionDismissals)
      .where(and(eq(calendarSuggestionDismissals.city, 'ottawa'), eq(calendarSuggestionDismissals.uid, 'uid-1@x')));
    expect(rows[0].eventSnapshotJson).toBe(JSON.stringify({ name: 'Ride A', start: '2026-05-10' }));
  });
});
