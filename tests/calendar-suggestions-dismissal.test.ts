import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from './test-db';
import type { Database } from '../src/db';
import {
  dismissSuggestion,
  listDismissedKeys,
  undismissSuggestion,
  NEVER_EXPIRES,
} from '../src/lib/calendar-suggestions/dismissals.server';

describe('calendar suggestion dismissals', () => {
  let h: ReturnType<typeof createTestDb>;
  let db: Database;
  beforeEach(() => { h = createTestDb(); db = h.db as unknown as Database; });
  afterEach(() => { h.cleanup(); });

  test('returns an empty set when nothing is dismissed', async () => {
    expect(await listDismissedKeys(db, 'ottawa', '2026-04-27')).toEqual(new Set());
  });

  test('returns dismissals whose valid_until is on or after today', async () => {
    await dismissSuggestion(db, 'ottawa', 'qbc',  'future@x',  '2026-05-10');
    await dismissSuggestion(db, 'ottawa', 'qbc',  'today@x',   '2026-04-27');
    await dismissSuggestion(db, 'ottawa', 'qbc',  'past@x',    '2026-04-26');
    const keys = await listDismissedKeys(db, 'ottawa', '2026-04-27');
    expect(keys).toEqual(new Set(['qbc:future@x', 'qbc:today@x']));
  });

  test('scopes to the requested city', async () => {
    await dismissSuggestion(db, 'ottawa', 'qbc',  'a@x', '2026-05-10');
    await dismissSuggestion(db, 'brevet', 'rcc',  'b@x', '2026-05-10');
    expect(await listDismissedKeys(db, 'ottawa', '2026-04-27'))
      .toEqual(new Set(['qbc:a@x']));
    expect(await listDismissedKeys(db, 'brevet', '2026-04-27'))
      .toEqual(new Set(['rcc:b@x']));
  });

  test('distinguishes two organizers with the same UID', async () => {
    // Without organizer_slug in the key, dismissing one would dismiss the other.
    await dismissSuggestion(db, 'ottawa', 'qbc',  'weekly-ride', '2026-09-30');
    await dismissSuggestion(db, 'ottawa', 'obmc', 'weekly-ride', '2026-09-30');
    await undismissSuggestion(db, 'ottawa', 'qbc', 'weekly-ride');
    const keys = await listDismissedKeys(db, 'ottawa', '2026-04-27');
    expect(keys).toEqual(new Set(['obmc:weekly-ride']));
  });

  test('NEVER_EXPIRES keeps a dismissal returned even far in the future', async () => {
    await dismissSuggestion(db, 'ottawa', 'qbc', 'unbounded@x', NEVER_EXPIRES);
    const keys = await listDismissedKeys(db, 'ottawa', '2099-01-01');
    expect(keys).toEqual(new Set(['qbc:unbounded@x']));
  });

  test('re-dismissing the same (org, uid) updates valid_until in place', async () => {
    await dismissSuggestion(db, 'ottawa', 'qbc', 'uid-1@x', '2026-04-26');
    // First dismiss expired yesterday — would not be returned today.
    expect(await listDismissedKeys(db, 'ottawa', '2026-04-27')).toEqual(new Set());
    // Re-dismiss with a future valid_until refreshes the lifetime.
    await dismissSuggestion(db, 'ottawa', 'qbc', 'uid-1@x', '2026-05-10');
    expect(await listDismissedKeys(db, 'ottawa', '2026-04-27'))
      .toEqual(new Set(['qbc:uid-1@x']));
  });

  test('undismiss removes the entry for that (org, uid) only', async () => {
    await dismissSuggestion(db, 'ottawa', 'qbc',  'uid-1@x', '2026-05-10');
    await dismissSuggestion(db, 'ottawa', 'obmc', 'uid-1@x', '2026-05-10');
    await undismissSuggestion(db, 'ottawa', 'qbc', 'uid-1@x');
    const keys = await listDismissedKeys(db, 'ottawa', '2026-04-27');
    expect(keys).toEqual(new Set(['obmc:uid-1@x']));
  });
});
