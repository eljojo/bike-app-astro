import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from './test-db';
import type { Database } from '../src/db';
import {
  dismissSuggestion,
  listDismissedKeys,
  undismissSuggestion,
} from '../src/lib/calendar-suggestions/dismissals.server';

describe('calendar suggestion dismissals', () => {
  let h: ReturnType<typeof createTestDb>;
  let db: Database;
  beforeEach(() => { h = createTestDb(); db = h.db as unknown as Database; });
  afterEach(() => { h.cleanup(); });

  test('listDismissedKeys returns an empty set when candidates is empty', async () => {
    expect(await listDismissedKeys(db, 'ottawa', [])).toEqual(new Set());
  });

  test('listDismissedKeys returns only dismissals that match candidates', async () => {
    // Seed three dismissals across two cities; query with two candidates from one city.
    await dismissSuggestion(db, 'ottawa', 'qbc', 'uid-1@x');
    await dismissSuggestion(db, 'ottawa', 'qbc', 'uid-2@x');
    await dismissSuggestion(db, 'ottawa', 'obmc', 'uid-3@x');
    await dismissSuggestion(db, 'brevet', 'rcc',  'uid-4@x');

    const keys = await listDismissedKeys(db, 'ottawa', [
      { organizer_slug: 'qbc',  uid: 'uid-1@x' },
      { organizer_slug: 'obmc', uid: 'uid-3@x' },
      { organizer_slug: 'qbc',  uid: 'never-dismissed@x' },
    ]);
    // Only the matching pairs are returned. Must NOT include uid-2@x (not in candidates)
    // or uid-4@x (different city), and must omit the unmatched candidate.
    expect(keys).toEqual(new Set(['qbc:uid-1@x', 'obmc:uid-3@x']));
  });

  test('listDismissedKeys distinguishes two organizers with the same UID', async () => {
    // Without organizer_slug in the PK, dismissing one would dismiss the other.
    await dismissSuggestion(db, 'ottawa', 'qbc',  'weekly-ride');
    const keys = await listDismissedKeys(db, 'ottawa', [
      { organizer_slug: 'qbc',  uid: 'weekly-ride' },
      { organizer_slug: 'obmc', uid: 'weekly-ride' },
    ]);
    expect(keys).toEqual(new Set(['qbc:weekly-ride']));
  });

  test('re-dismissing the same (org, uid) is idempotent', async () => {
    await dismissSuggestion(db, 'ottawa', 'qbc', 'uid-1@x');
    await dismissSuggestion(db, 'ottawa', 'qbc', 'uid-1@x');
    const keys = await listDismissedKeys(db, 'ottawa', [
      { organizer_slug: 'qbc', uid: 'uid-1@x' },
    ]);
    expect(keys.size).toBe(1);
  });

  test('undismiss removes the entry for that org+uid only', async () => {
    await dismissSuggestion(db, 'ottawa', 'qbc',  'uid-1@x');
    await dismissSuggestion(db, 'ottawa', 'obmc', 'uid-1@x');
    await undismissSuggestion(db, 'ottawa', 'qbc', 'uid-1@x');
    const keys = await listDismissedKeys(db, 'ottawa', [
      { organizer_slug: 'qbc',  uid: 'uid-1@x' },
      { organizer_slug: 'obmc', uid: 'uid-1@x' },
    ]);
    expect(keys).toEqual(new Set(['obmc:uid-1@x']));
  });
});
