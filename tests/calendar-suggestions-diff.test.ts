import { describe, test, expect } from 'vitest';
import { diffMonitored } from '../src/lib/calendar-suggestions/diff';
import type { ParsedVEvent } from '../src/lib/calendar-suggestions/types';
import { isNonEmpty } from '../src/lib/calendar-suggestions/types';

const TODAY = '2026-05-06';

function oneOff(over: Partial<ParsedVEvent>): ParsedVEvent {
  return {
    uid: 'u1',
    summary: 'Coffee Ride',
    start: '2026-06-20T18:00:00',
    location: 'Britannia Park',
    ...over,
  };
}

describe('diffMonitored — one-off events', () => {
  test('returns empty diff when snapshot equals upstream on all monitored fields', () => {
    const snap = oneOff({});
    const up   = oneOff({});
    const d = diffMonitored(snap, snap, up, TODAY);
    expect(isNonEmpty(d)).toBe(false);
  });

  test('emits a master FieldDiff when location changes', () => {
    const snap = oneOff({ location: 'Britannia Park' });
    const up   = oneOff({ location: 'Andrew Haydon Park' });
    const d = diffMonitored(snap, snap, up, TODAY);
    expect(d.master).toEqual([{
      field: 'location',
      mine: 'Britannia Park',
      upstream: 'Andrew Haydon Park',
    }]);
  });

  test('emits multiple master FieldDiffs when several fields change', () => {
    const snap = oneOff({ location: 'A', start: '2026-06-20T18:00:00' });
    const up   = oneOff({ location: 'B', start: '2026-06-20T18:30:00' });
    const d = diffMonitored(snap, snap, up, TODAY);
    expect(d.master.map(f => f.field).sort()).toEqual(['location', 'start']);
  });

  test('ignores non-monitored fields (description differs but no diff emitted)', () => {
    const snap = oneOff({ description: 'old text' });
    const up   = oneOff({ description: 'new text' });
    expect(isNonEmpty(diffMonitored(snap, snap, up, TODAY))).toBe(false);
  });

  test('whole-event removal: future-dated repo event with null upstream → eventRemoved', () => {
    const snap = oneOff({ start: '2026-06-20T18:00:00' });
    const d = diffMonitored(snap, snap, null, TODAY);
    expect(d.eventRemoved).toBe(true);
  });

  test('whole-event removal: past-dated → empty diff (feed mechanics)', () => {
    const snap = oneOff({ start: '2026-04-01T18:00:00' });
    const d = diffMonitored(snap, snap, null, TODAY);
    expect(isNonEmpty(d)).toBe(false);
  });

  test('null snapshot, non-null upstream → empty (bootstrap path; caller writes snapshot)', () => {
    const up = oneOff({});
    expect(isNonEmpty(diffMonitored(null, null, up, TODAY))).toBe(false);
  });
});

describe('diffMonitored — series', () => {
  function series(overrides: NonNullable<ParsedVEvent['series']>['overrides']): ParsedVEvent {
    return {
      uid: 'master',
      summary: 'Wednesday Coffee Ride',
      start: '2026-06-03T18:00:00',
      location: 'Britannia Park',
      series: {
        kind: 'recurrence',
        recurrence: 'weekly',
        recurrence_day: 'wednesday',
        season_start: '2026-06-03',
        season_end: '2026-08-26',
        overrides,
      },
    };
  }

  test('per-occurrence registration_url change emits ChangedOccurrence', () => {
    const snap = series([{ uid: 'o1', date: '2026-07-08', registration_url: 'https://rwgps/a' }]);
    const up   = series([{ uid: 'o1', date: '2026-07-08', registration_url: 'https://rwgps/b' }]);
    const d = diffMonitored(snap, snap, up, TODAY);
    expect(d.occurrencesChanged).toHaveLength(1);
    expect(d.occurrencesChanged[0].uid).toBe('o1');
    expect(d.occurrencesChanged[0].fields[0].field).toBe('registration_url');
  });

  test('new occurrence with date >= today → occurrencesAdded; date < today → filtered', () => {
    const snap = series([{ uid: 'o1', date: '2026-07-08' }]);
    const up   = series([
      { uid: 'o1', date: '2026-07-08' },
      { uid: 'o2', date: '2026-08-05' },           // future
      { uid: 'o3', date: '2026-04-01' },           // past
    ]);
    const d = diffMonitored(snap, snap, up, TODAY);
    expect(d.occurrencesAdded.map(o => o.uid)).toEqual(['o2']);
  });

  test('cancelled flipping from undefined to true → occurrencesNewlyCancelled', () => {
    const snap = series([{ uid: 'o1', date: '2026-07-08' }]);
    const up   = series([{ uid: 'o1', date: '2026-07-08', cancelled: true }]);
    const d = diffMonitored(snap, snap, up, TODAY);
    expect(d.occurrencesNewlyCancelled).toEqual([{ uid: 'o1', date: '2026-07-08', fields: [] }]);
    expect(d.occurrencesChanged).toEqual([]);
  });

  test('cancelled flipping on + co-occurring location change → occurrencesNewlyCancelled carries fields; NOT in occurrencesChanged', () => {
    const snap = series([{ uid: 'o1', date: '2026-07-08', location: 'A' }]);
    const up   = series([{ uid: 'o1', date: '2026-07-08', cancelled: true, location: 'B' }]);
    const d = diffMonitored(snap, snap, up, TODAY);
    expect(d.occurrencesNewlyCancelled).toEqual([{
      uid: 'o1',
      date: '2026-07-08',
      fields: [{ field: 'location', mine: 'A', upstream: 'B' }],
    }]);
    expect(d.occurrencesChanged).toEqual([]);
  });

  test('uid in snapshot, missing from upstream, future-dated → occurrencesRemoved', () => {
    const snap = series([
      { uid: 'o1', date: '2026-07-08' },
      { uid: 'o2', date: '2026-08-05' },
    ]);
    const up = series([{ uid: 'o1', date: '2026-07-08' }]);
    const d = diffMonitored(snap, snap, up, TODAY);
    expect(d.occurrencesRemoved).toEqual([{ uid: 'o2', date: '2026-08-05' }]);
  });

  test('past-dated removed occurrence is filtered (feed mechanics)', () => {
    const snap = series([{ uid: 'o1', date: '2026-04-01' }]);
    const up   = series([]);
    const d = diffMonitored(snap, snap, up, TODAY);
    expect(d.occurrencesRemoved).toEqual([]);
  });
});

describe('diffMonitored — tolerance', () => {
  test('snapshot missing a monitored key (e.g., older snapshot has no map_url) → no false-positive diff', () => {
    const snap = oneOff({});                                  // map_url undefined
    const up   = oneOff({ map_url: 'https://goo.gl/maps/x' });
    const d = diffMonitored(snap, snap, up, TODAY);
    // Tolerant: undefined-on-snapshot is "no opinion" — no diff for that field.
    expect(d.master).toEqual([]);
  });
});

describe('diffMonitored — Mine reflects repo (not snapshot)', () => {
  function event(over: Partial<ParsedVEvent>): ParsedVEvent {
    return { uid: 'u1', summary: 'X', start: '2026-06-20T18:00:00', ...over };
  }

  test('master field: snapshot=A, repo=A-with-local-edit, upstream=B → mine = repo value', () => {
    const snap = event({ location: 'Britannia Park' });
    const repo = event({ location: 'Britannia Park (gazebo)' });    // admin's local edit
    const up   = event({ location: 'Andrew Haydon Park' });
    const d = diffMonitored(repo, snap, up, '2026-05-06');
    expect(d.master).toEqual([{
      field: 'location',
      mine: 'Britannia Park (gazebo)',     // repo value, not snapshot
      upstream: 'Andrew Haydon Park',
    }]);
  });

  test('master field: when repo == snapshot, mine still reads from repo (same value)', () => {
    const snap = event({ location: 'A' });
    const repo = event({ location: 'A' });
    const up   = event({ location: 'B' });
    const d = diffMonitored(repo, snap, up, '2026-05-06');
    expect(d.master[0].mine).toBe('A');
  });

  test('master field: repo null → mine = undefined (degraded behavior)', () => {
    const snap = event({ location: 'A' });
    const up   = event({ location: 'B' });
    const d = diffMonitored(null, snap, up, '2026-05-06');
    expect(d.master[0].mine).toBeUndefined();
  });

  test('per-occurrence: snapshot=A, repo override=A-edited, upstream=B → mine = repo override', () => {
    const series = (loc: string): ParsedVEvent => event({
      series: { kind: 'recurrence', recurrence: 'weekly', recurrence_day: 'wednesday',
                season_start: '2026-06-03', season_end: '2026-08-26',
                overrides: [{ uid: 'o1', date: '2026-07-08', location: loc }] },
    });
    const snap = series('Britannia Park');
    const repo = series('Britannia Park (gazebo)');
    const up   = series('Andrew Haydon Park');
    const d = diffMonitored(repo, snap, up, '2026-05-06');
    expect(d.occurrencesChanged).toHaveLength(1);
    expect(d.occurrencesChanged[0].fields[0]).toEqual({
      field: 'location', mine: 'Britannia Park (gazebo)', upstream: 'Andrew Haydon Park',
    });
  });
});
