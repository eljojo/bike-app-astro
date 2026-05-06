import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from './test-db';
import type { Database } from '../src/db';
import {
  advanceSnapshot,
  deleteSnapshot,
  loadAllSnapshots,
  computeExpiresAt,
  NEVER_EXPIRES,
} from '../src/lib/calendar-suggestions/snapshots.server';
import type { ParsedVEvent } from '../src/lib/calendar-suggestions/types';

function makeVEvent(over: Partial<ParsedVEvent> = {}): ParsedVEvent {
  return { uid: 'u1', summary: 'X', start: '2026-06-20T18:00:00', ...over };
}

describe('snapshots — advance / load / delete', () => {
  let h: ReturnType<typeof createTestDb>;
  let db: Database;
  beforeEach(() => { h = createTestDb(); db = h.db as unknown as Database; });
  afterEach(() => { h.cleanup(); });

  test('advanceSnapshot inserts a row; loadAllSnapshots returns it', async () => {
    const v = makeVEvent({ uid: 'u1', summary: 'Coffee', location: 'Britannia' });
    await advanceSnapshot(db, 'ottawa', 'obc', 'u1', v, '2026-06-20');
    const map = await loadAllSnapshots(db, 'ottawa', '2026-05-06');
    expect(map.size).toBe(1);
    expect(map.get('obc:u1')?.summary).toBe('Coffee');
  });

  test('advanceSnapshot upserts on PK conflict; second call updates expires_at and snapshotted_at', async () => {
    const v1 = makeVEvent({ uid: 'u1', location: 'A' });
    const v2 = makeVEvent({ uid: 'u1', location: 'B' });
    await advanceSnapshot(db, 'ottawa', 'obc', 'u1', v1, '2026-06-20');
    await advanceSnapshot(db, 'ottawa', 'obc', 'u1', v2, '2026-09-20');
    const map = await loadAllSnapshots(db, 'ottawa', '2026-05-06');
    expect(map.get('obc:u1')?.location).toBe('B');
    expect((await loadAllSnapshots(db, 'ottawa', '2026-08-01')).size).toBe(1);
  });

  test('loadAllSnapshots filters out rows whose expires_at < today', async () => {
    await advanceSnapshot(db, 'ottawa', 'obc', 'old', makeVEvent({ uid: 'old' }), '2026-04-01');
    await advanceSnapshot(db, 'ottawa', 'obc', 'new', makeVEvent({ uid: 'new' }), '2026-08-01');
    const map = await loadAllSnapshots(db, 'ottawa', '2026-05-06');
    expect([...map.keys()]).toEqual(['obc:new']);
  });

  test('loadAllSnapshots scopes by city — multi-city isolation', async () => {
    await advanceSnapshot(db, 'ottawa',  'obc', 'u1', makeVEvent({ uid: 'u1' }), '2026-06-20');
    await advanceSnapshot(db, 'toronto', 'obc', 'u1', makeVEvent({ uid: 'u1' }), '2026-06-20');
    expect((await loadAllSnapshots(db, 'ottawa',  '2026-05-06')).size).toBe(1);
    expect((await loadAllSnapshots(db, 'toronto', '2026-05-06')).size).toBe(1);
  });

  test('deleteSnapshot removes the row', async () => {
    await advanceSnapshot(db, 'ottawa', 'obc', 'u1', makeVEvent({ uid: 'u1' }), '2026-06-20');
    await deleteSnapshot(db, 'ottawa', 'obc', 'u1');
    expect((await loadAllSnapshots(db, 'ottawa', '2026-05-06')).size).toBe(0);
  });
});

describe('computeExpiresAt', () => {
  test('one-off with end_date → end_date', () => {
    expect(computeExpiresAt({ start_date: '2026-06-20', end_date: '2026-06-22' } as any))
      .toBe('2026-06-22');
  });
  test('one-off with only start_date → start_date', () => {
    expect(computeExpiresAt({ start_date: '2026-06-20' } as any)).toBe('2026-06-20');
  });
  test('series with season_end → season_end', () => {
    expect(computeExpiresAt({
      start_date: '2026-06-03',
      series: { kind: 'recurrence', season_end: '2026-08-26' },
    } as any)).toBe('2026-08-26');
  });
  test('series with schedule[] → max(schedule[].date)', () => {
    expect(computeExpiresAt({
      start_date: '2026-06-03',
      series: {
        kind: 'schedule',
        schedule: [{ date: '2026-06-10' }, { date: '2026-08-15' }, { date: '2026-07-04' }],
      },
    } as any)).toBe('2026-08-15');
  });
  test('unbounded series (no season_end, empty schedule) → NEVER_EXPIRES', () => {
    expect(computeExpiresAt({
      start_date: '2026-06-03',
      series: { kind: 'recurrence' },
    } as any)).toBe(NEVER_EXPIRES);
  });
});
