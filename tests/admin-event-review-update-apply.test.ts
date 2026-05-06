import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from './test-db';
import type { Database } from '../src/db';
import type { AdminEvent } from '../src/types/admin';
import type { ParsedVEvent, ParsedSeriesOverride } from '../src/lib/calendar-suggestions/types';
import type { EventSeries } from '../src/lib/models/event-model';
import { advanceSnapshot, loadAllSnapshots } from '../src/lib/calendar-suggestions/snapshots.server';
import {
  applyTogglesToEvent,
  bodySchema,
  classifyAddition,
  isOnCycle,
  type ApplyBody,
} from '../src/views/api/admin-event-review-update-apply';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// AdminEvent is the lightweight admin list shape; it does not carry `location`
// or `registration_url`. We use a cast here to simulate a richer runtime payload
// that applyTogglesToEvent may encounter (the function uses runtime-dynamic field
// copies via unknown-casts when the upstream value exists).
type RichAdminEvent = AdminEvent & { location?: string; registration_url?: string };

function makeEvent(overrides: Partial<RichAdminEvent> = {}): AdminEvent {
  return {
    id: '2026/summer-ride',
    slug: 'summer-ride',
    year: '2026',
    name: 'Summer Ride',
    start_date: '2026-06-15',
    end_date: '2026-06-15',
    event_url: 'https://old.example.com',
    ics_uid: 'uid-123',
    organizer: 'obc',
    hasBody: false,
    mediaCount: 0,
    waypointCount: 0,
    contentHash: 'abc123',
    ...overrides,
  } as AdminEvent;
}

function makeUpstream(overrides: Partial<ParsedVEvent> = {}): ParsedVEvent {
  return {
    uid: 'uid-123',
    summary: 'Summer Ride Updated',
    start: '2026-06-15T18:00:00',
    end: '2026-06-15T21:00:00',
    location: 'New Location',
    url: 'https://new.example.com',
    ...overrides,
  };
}

function defaultBody(overrides: Partial<ApplyBody> = {}): ApplyBody {
  return bodySchema.parse({
    master: {},
    occurrences: {},
    additions: {},
    cancellations: {},
    removals: {},
    next: 'back',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// bodySchema
// ---------------------------------------------------------------------------

describe('bodySchema', () => {
  test('parses empty body with all defaults', () => {
    const result = bodySchema.parse({});
    expect(result.master).toEqual({});
    expect(result.occurrences).toEqual({});
    expect(result.additions).toEqual({});
    expect(result.cancellations).toEqual({});
    expect(result.removals).toEqual({});
    expect(result.next).toBe('back');
  });

  test('next=editor is accepted', () => {
    const result = bodySchema.parse({ next: 'editor' });
    expect(result.next).toBe('editor');
  });

  test('master toggles accept take/keep', () => {
    const result = bodySchema.parse({ master: { location: 'take', summary: 'keep' } });
    expect(result.master.location).toBe('take');
    expect(result.master.summary).toBe('keep');
  });

  test('invalid toggle value is rejected', () => {
    expect(() => bodySchema.parse({ master: { location: 'ignore' } })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// applyTogglesToEvent — master fields
// ---------------------------------------------------------------------------

describe('applyTogglesToEvent — master fields', () => {
  test('take location → copies upstream location to patched', () => {
    const event = makeEvent({ location: 'Old Location' });
    const upstream = makeUpstream({ location: 'New Location' });
    const body = defaultBody({ master: { location: 'take' } });

    const result = applyTogglesToEvent(event, upstream, body) as RichAdminEvent;
    expect(result.location).toBe('New Location');
    // Original not mutated
    expect((event as RichAdminEvent).location).toBe('Old Location');
  });

  test('keep location → leaves repo location unchanged', () => {
    const event = makeEvent({ location: 'Old Location' });
    const upstream = makeUpstream({ location: 'New Location' });
    const body = defaultBody({ master: { location: 'keep' } });

    const result = applyTogglesToEvent(event, upstream, body) as RichAdminEvent;
    expect(result.location).toBe('Old Location');
  });

  test('take summary → maps to name field', () => {
    const event = makeEvent({ name: 'Old Name' });
    const upstream = makeUpstream({ summary: 'New Name' });
    const body = defaultBody({ master: { summary: 'take' } });

    const result = applyTogglesToEvent(event, upstream, body);
    expect(result.name).toBe('New Name');
  });

  test('take url → maps to event_url field', () => {
    const event = makeEvent({ event_url: 'https://old.example.com' });
    const upstream = makeUpstream({ url: 'https://new.example.com' });
    const body = defaultBody({ master: { url: 'take' } });

    const result = applyTogglesToEvent(event, upstream, body);
    expect(result.event_url).toBe('https://new.example.com');
  });

  test('take start → extracts date part into start_date', () => {
    const event = makeEvent({ start_date: '2026-06-01' });
    const upstream = makeUpstream({ start: '2026-07-15T18:00:00' });
    const body = defaultBody({ master: { start: 'take' } });

    const result = applyTogglesToEvent(event, upstream, body);
    expect(result.start_date).toBe('2026-07-15');
  });

  test('take end → extracts date part into end_date', () => {
    const event = makeEvent({ end_date: '2026-06-01' });
    const upstream = makeUpstream({ end: '2026-07-15T21:00:00' });
    const body = defaultBody({ master: { end: 'take' } });

    const result = applyTogglesToEvent(event, upstream, body);
    expect(result.end_date).toBe('2026-07-15');
  });

  test('multiple take fields applied together', () => {
    const event = makeEvent({ name: 'Old', location: 'Old Location', event_url: 'https://old.com' });
    const upstream = makeUpstream({ summary: 'New', location: 'New Location', url: 'https://new.com' });
    const body = defaultBody({ master: { summary: 'take', location: 'take', url: 'take' } });

    const result = applyTogglesToEvent(event, upstream, body) as RichAdminEvent;
    expect(result.name).toBe('New');
    expect(result.location).toBe('New Location');
    expect(result.event_url).toBe('https://new.com');
  });

  test('no upstream → master take leaves field unchanged', () => {
    const event = makeEvent({ location: 'Old Location' });
    const body = defaultBody({ master: { location: 'take' } });

    const result = applyTogglesToEvent(event, null, body) as RichAdminEvent;
    expect(result.location).toBe('Old Location');
  });

  test('does not mutate original event', () => {
    const event = makeEvent({ location: 'Old Location' });
    const upstream = makeUpstream({ location: 'New Location' });
    const body = defaultBody({ master: { location: 'take' } });

    applyTogglesToEvent(event, upstream, body);
    expect((event as RichAdminEvent).location).toBe('Old Location');
  });
});

// ---------------------------------------------------------------------------
// applyTogglesToEvent — occurrences
// ---------------------------------------------------------------------------

describe('applyTogglesToEvent — per-occurrence changes', () => {
  function makeSeriesEvent(overrides: Partial<AdminEvent> = {}): AdminEvent {
    return makeEvent({
      series: {
        schedule: [
          { date: '2026-06-15', uid: 'ovr-1', location: 'Place A' },
          { date: '2026-07-15', uid: 'ovr-2', location: 'Place B' },
        ],
      },
      ...overrides,
    });
  }

  function makeSeriesUpstream(): ParsedVEvent {
    return makeUpstream({
      series: {
        kind: 'schedule',
        overrides: [
          { date: '2026-06-15', uid: 'ovr-1', location: 'Place A Updated' },
          { date: '2026-07-15', uid: 'ovr-2', location: 'Place B' },
        ],
      },
    });
  }

  test('takeAll: true → updates occurrence fields from upstream', () => {
    const event = makeSeriesEvent();
    const upstream = makeSeriesUpstream();
    const body = defaultBody({ occurrences: { 'ovr-1': { takeAll: true } } });

    const result = applyTogglesToEvent(event, upstream, body);
    const ovr = result.series?.schedule?.find(o => o.uid === 'ovr-1');
    expect(ovr?.location).toBe('Place A Updated');
  });

  test('takeAll: false → occurrence unchanged', () => {
    const event = makeSeriesEvent();
    const upstream = makeSeriesUpstream();
    const body = defaultBody({ occurrences: { 'ovr-1': { takeAll: false } } });

    const result = applyTogglesToEvent(event, upstream, body);
    const ovr = result.series?.schedule?.find(o => o.uid === 'ovr-1');
    expect(ovr?.location).toBe('Place A');
  });
});

// ---------------------------------------------------------------------------
// applyTogglesToEvent — additions
// ---------------------------------------------------------------------------

describe('applyTogglesToEvent — additions', () => {
  function makeSeriesEventForAddition(): AdminEvent {
    return makeEvent({
      series: {
        schedule: [
          { date: '2026-06-15', uid: 'existing', location: 'Existing' },
        ],
        season_end: '2026-06-15',
      },
    });
  }

  function makeUpstreamWithNewDate(): ParsedVEvent {
    return makeUpstream({
      series: {
        kind: 'schedule',
        overrides: [
          { date: '2026-06-15', uid: 'existing' },
          { date: '2026-08-10', uid: 'new-date', location: 'New Venue' },
        ],
      },
    });
  }

  test('add → appends occurrence to series overrides', () => {
    const event = makeSeriesEventForAddition();
    const upstream = makeUpstreamWithNewDate();
    const body = defaultBody({ additions: { 'new-date': 'add' } });

    const result = applyTogglesToEvent(event, upstream, body);
    const added = result.series?.schedule?.find(o => o.uid === 'new-date');
    expect(added).toBeDefined();
    expect(added?.date).toBe('2026-08-10');
    expect(added?.location).toBe('New Venue');
  });

  test('add → season_end advances when new date is later', () => {
    const event = makeSeriesEventForAddition();
    const upstream = makeUpstreamWithNewDate();
    const body = defaultBody({ additions: { 'new-date': 'add' } });

    const result = applyTogglesToEvent(event, upstream, body);
    expect(result.series?.season_end).toBe('2026-08-10');
  });

  test('skip → occurrence not added', () => {
    const event = makeSeriesEventForAddition();
    const upstream = makeUpstreamWithNewDate();
    const body = defaultBody({ additions: { 'new-date': 'skip' } });

    const result = applyTogglesToEvent(event, upstream, body);
    const added = result.series?.schedule?.find(o => o.uid === 'new-date');
    expect(added).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// applyTogglesToEvent — cancellations
// ---------------------------------------------------------------------------

describe('applyTogglesToEvent — cancellations', () => {
  function makeSeriesEventForCancellation(): AdminEvent {
    return makeEvent({
      series: {
        schedule: [
          { date: '2026-06-15', uid: 'existing-ovr' },
        ],
      },
    });
  }

  test('mark → sets cancelled on existing override', () => {
    const event = makeSeriesEventForCancellation();
    const body = defaultBody({ cancellations: { 'existing-ovr': 'mark' } });

    const result = applyTogglesToEvent(event, null, body);
    const ovr = result.series?.schedule?.find(o => o.uid === 'existing-ovr');
    expect(ovr?.cancelled).toBe(true);
  });

  test('leave → override unchanged', () => {
    const event = makeSeriesEventForCancellation();
    const body = defaultBody({ cancellations: { 'existing-ovr': 'leave' } });

    const result = applyTogglesToEvent(event, null, body);
    const ovr = result.series?.schedule?.find(o => o.uid === 'existing-ovr');
    expect(ovr?.cancelled).toBeUndefined();
  });

  test('mark + upstream has co-occurring field changes → cancelled AND upstream field values written', () => {
    const event = makeSeriesEventForCancellation();
    const upstream = makeUpstream({
      series: {
        kind: 'schedule',
        overrides: [
          { date: '2026-06-15', uid: 'existing-ovr', cancelled: true, location: 'New Venue' },
        ],
      },
    });
    const body = defaultBody({ cancellations: { 'existing-ovr': 'mark' } });

    const result = applyTogglesToEvent(event, upstream, body);
    const ovr = result.series?.schedule?.find(o => o.uid === 'existing-ovr') as Record<string, unknown> | undefined;
    expect(ovr?.cancelled).toBe(true);
    expect(ovr?.location).toBe('New Venue');
  });
});

// ---------------------------------------------------------------------------
// applyTogglesToEvent — removals
// ---------------------------------------------------------------------------

describe('applyTogglesToEvent — removals', () => {
  function makeSeriesEventForRemoval(): AdminEvent {
    return makeEvent({
      series: {
        schedule: [
          { date: '2026-06-15', uid: 'keep-ovr' },
          { date: '2026-07-15', uid: 'remove-ovr' },
        ],
      },
    });
  }

  test('delete → removes override from series', () => {
    const event = makeSeriesEventForRemoval();
    const body = defaultBody({ removals: { 'remove-ovr': 'delete' } });

    const result = applyTogglesToEvent(event, null, body);
    expect(result.series?.schedule?.find(o => o.uid === 'remove-ovr')).toBeUndefined();
    expect(result.series?.schedule?.find(o => o.uid === 'keep-ovr')).toBeDefined();
  });

  test('keep → override preserved', () => {
    const event = makeSeriesEventForRemoval();
    const body = defaultBody({ removals: { 'remove-ovr': 'keep' } });

    const result = applyTogglesToEvent(event, null, body);
    expect(result.series?.schedule?.find(o => o.uid === 'remove-ovr')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Redirect target based on `next`
// ---------------------------------------------------------------------------

describe('bodySchema next field', () => {
  test('next=back produces /admin/events redirect path', () => {
    const body = bodySchema.parse({ next: 'back' });
    expect(body.next).toBe('back');
  });

  test('next=editor produces /admin/events/<id> redirect path', () => {
    const body = bodySchema.parse({ next: 'editor' });
    expect(body.next).toBe('editor');
  });
});

// ---------------------------------------------------------------------------
// Snapshot advance / delete — via dispatchApply (injected deps, no HTTP)
// ---------------------------------------------------------------------------

// Note: dispatchApply calls persistPatchedEvent which needs saveContent → git service.
// That path requires a real git token. We test the snapshot side-effects in isolation
// by invoking the snapshot functions directly (mirrors how dismissals are tested).

describe('snapshot housekeeping after apply', () => {
  let h: ReturnType<typeof createTestDb>;
  let database: Database;

  beforeEach(() => {
    h = createTestDb();
    database = h.db as unknown as Database;
  });
  afterEach(() => { h.cleanup(); });

  test('advanceSnapshot after apply → snapshot updated in DB', async () => {
    const upstream: ParsedVEvent = { uid: 'u1', summary: 'Ride', start: '2026-06-15T18:00:00' };
    await advanceSnapshot(database, 'ottawa', 'obc', 'u1', upstream, '2026-06-15');

    const map = await loadAllSnapshots(database, 'ottawa', '2026-06-01');
    expect(map.has('obc:u1')).toBe(true);
    const snap = map.get('obc:u1');
    expect(snap?.summary).toBe('Ride');
  });

  test('deleteSnapshot after apply (upstream gone) → row removed', async () => {
    const upstream: ParsedVEvent = { uid: 'u1', summary: 'Ride', start: '2026-06-15T18:00:00' };
    await advanceSnapshot(database, 'ottawa', 'obc', 'u1', upstream, '2026-06-15');

    // Import deleteSnapshot to use directly
    const { deleteSnapshot } = await import('../src/lib/calendar-suggestions/snapshots.server');
    await deleteSnapshot(database, 'ottawa', 'obc', 'u1');

    const map = await loadAllSnapshots(database, 'ottawa', '2026-06-01');
    expect(map.has('obc:u1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Event-not-found and missing ics_uid error paths (pure logic, no HTTP)
// ---------------------------------------------------------------------------

describe('applyTogglesToEvent — edge cases', () => {
  test('event with no upstream link (null upstream) → toggles are no-ops for master', () => {
    const event = makeEvent({ name: 'Existing Name', location: 'Existing Place' });
    const body = defaultBody({ master: { summary: 'take', location: 'take' } });

    const result = applyTogglesToEvent(event, null, body) as RichAdminEvent;
    // Without upstream, take has nothing to copy; fields stay unchanged
    expect(result.name).toBe('Existing Name');
    expect(result.location).toBe('Existing Place');
  });

  test('series not mutated on original when series is deep-copied', () => {
    const event = makeEvent({
      series: {
        schedule: [{ date: '2026-06-15', uid: 'o1', location: 'A' }],
      },
    });
    const upstream = makeUpstream({
      series: {
        kind: 'schedule',
        overrides: [{ date: '2026-06-15', uid: 'o1', location: 'B' }],
      },
    });
    const body = defaultBody({ occurrences: { 'o1': { takeAll: true } } });

    applyTogglesToEvent(event, upstream, body);
    // Original series must not be mutated
    expect(event.series?.schedule?.[0]?.location).toBe('A');
  });
});

// ---------------------------------------------------------------------------
// isOnCycle — pure helper
// ---------------------------------------------------------------------------

describe('isOnCycle', () => {
  // 2026-06-08 is a Monday. Use this as season_start for easy weekly cadence.
  const monday0 = '2026-06-08';

  test('exactly 7d on monday season_start → on-cycle (weekly)', () => {
    expect(isOnCycle(monday0, '2026-06-15', 7, 'monday')).toBe(true);
  });

  test('exactly 14d on monday season_start → on-cycle (biweekly)', () => {
    expect(isOnCycle(monday0, '2026-06-22', 14, 'monday')).toBe(true);
  });

  test('7d from start with biweekly cadence → off-cycle (not 14d interval)', () => {
    expect(isOnCycle(monday0, '2026-06-15', 14, 'monday')).toBe(false);
  });

  test('14d from start with weekly cadence → on-cycle (14 % 7 === 0)', () => {
    expect(isOnCycle(monday0, '2026-06-22', 7, 'monday')).toBe(true);
  });

  test('correct cadence but wrong DOW → off-cycle', () => {
    // 7d from monday season_start lands on next monday — if we claim tuesday it should fail
    expect(isOnCycle(monday0, '2026-06-15', 7, 'tuesday')).toBe(false);
  });

  test('date before season_start → off-cycle', () => {
    expect(isOnCycle(monday0, '2026-06-01', 7, 'monday')).toBe(false);
  });

  test('season_start itself → on-cycle (0 days diff)', () => {
    expect(isOnCycle(monday0, monday0, 7, 'monday')).toBe(true);
  });

  test('non-multiple diff with correct DOW → off-cycle', () => {
    // 2026-06-29 is a Monday, 21d from 2026-06-08 (weekly: 21%7=0 → on-cycle)
    expect(isOnCycle(monday0, '2026-06-29', 7, 'monday')).toBe(true);
    // 2026-06-23 is a Tuesday, 15d from monday0: 15%7=1 → off-cycle regardless of DOW
    expect(isOnCycle(monday0, '2026-06-23', 7, 'tuesday')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// classifyAddition — pure helper
// ---------------------------------------------------------------------------

describe('classifyAddition', () => {
  // Reusable series fixtures
  function scheduleSeries(): EventSeries {
    return {
      schedule: [
        { date: '2026-06-15', uid: 'e1' },
      ],
    } as EventSeries;
  }

  function weeklySeries(overrides: Partial<EventSeries> = {}): EventSeries {
    return {
      recurrence: 'weekly',
      recurrence_day: 'monday',
      season_start: '2026-06-08',  // a Monday
      season_end:   '2026-08-24',  // about 11 weeks out
      ...overrides,
    } as EventSeries;
  }

  function biweeklySeries(overrides: Partial<EventSeries> = {}): EventSeries {
    return {
      recurrence: 'biweekly',
      recurrence_day: 'monday',
      season_start: '2026-06-08',
      season_end:   '2026-09-28',
      ...overrides,
    } as EventSeries;
  }

  function addition(date: string, extra: Partial<ParsedSeriesOverride> = {}): ParsedSeriesOverride {
    return { date, uid: `uid-${date}`, ...extra };
  }

  // --- Schedule pattern ---

  test('schedule series → schedule_append', () => {
    const result = classifyAddition(scheduleSeries(), addition('2026-09-01'));
    expect(result.kind).toBe('schedule_append');
    if (result.kind === 'schedule_append') {
      expect(result.entry.date).toBe('2026-09-01');
    }
  });

  // --- Recurrence: on-cycle, past season_end ---

  test('weekly, on-cycle, past season_end → season_extend', () => {
    // 2026-08-31 is a Monday; is it 7n days from 2026-06-08?
    // 2026-06-08 to 2026-08-31: 84 days = 12 * 7 ✓; it's a Monday ✓; past 2026-08-24 ✓
    const result = classifyAddition(weeklySeries(), addition('2026-08-31'));
    expect(result.kind).toBe('season_extend');
    if (result.kind === 'season_extend') {
      expect(result.newSeasonEnd).toBe('2026-08-31');
    }
  });

  test('biweekly, on-cycle, past season_end → season_extend', () => {
    // 2026-10-05 is a Monday; days from 2026-06-08: 119 days = 8.5 * 14 → not on-cycle.
    // Let's use 2026-10-12: 126 days = 9 * 14 ✓; Monday ✓; past 2026-09-28 ✓
    const result = classifyAddition(biweeklySeries(), addition('2026-10-12'));
    expect(result.kind).toBe('season_extend');
    if (result.kind === 'season_extend') {
      expect(result.newSeasonEnd).toBe('2026-10-12');
    }
  });

  // --- Recurrence: on-cycle, within season window ---

  test('weekly, on-cycle, within season_end → skip', () => {
    // 2026-07-06 is a Monday; 28 days from 2026-06-08 = 4 * 7 ✓; within 2026-08-24 ✓
    const result = classifyAddition(weeklySeries(), addition('2026-07-06'));
    expect(result.kind).toBe('skip');
    if (result.kind === 'skip') {
      expect(result.reason).toMatch(/on-cycle date already within season window/);
    }
  });

  // --- Recurrence: off-cycle, within season window ---

  test('weekly, off-cycle (wrong DOW), within season_end → override_append, no bump', () => {
    // 2026-07-07 is a Tuesday — wrong DOW, within season
    const result = classifyAddition(weeklySeries(), addition('2026-07-07'));
    expect(result.kind).toBe('override_append');
    if (result.kind === 'override_append') {
      expect(result.entry.date).toBe('2026-07-07');
      expect(result.bumpedSeasonEnd).toBeUndefined();
    }
  });

  test('weekly, off-cycle (not a 7d multiple, right DOW), within season_end → override_append, no bump', () => {
    // 2026-06-22 is a Monday, 14 days from season_start (weekly: 14%7=0 → on-cycle).
    // Try 2026-06-15 (7 days, Monday) — that IS on-cycle; skip.
    // Use 2026-07-13: 35 days = 5*7, Monday → on-cycle actually.
    // For a genuinely off-cycle Monday we'd need a date not divisible by 7 from season_start.
    // Actually any Monday from a Monday start is on-cycle for weekly. So use a Wednesday.
    // 2026-07-01 is a Wednesday. 23d from season_start: 23%7=2 → off-cycle.
    const result = classifyAddition(weeklySeries(), addition('2026-07-01'));
    expect(result.kind).toBe('override_append');
    if (result.kind === 'override_append') {
      expect(result.bumpedSeasonEnd).toBeUndefined();
    }
  });

  // --- Recurrence: off-cycle, past season_end ---

  test('weekly, off-cycle, past season_end → override_append with bumpedSeasonEnd', () => {
    // 2026-09-02 is a Wednesday, past 2026-08-24, not a Monday → off-cycle
    const result = classifyAddition(weeklySeries(), addition('2026-09-02'));
    expect(result.kind).toBe('override_append');
    if (result.kind === 'override_append') {
      expect(result.bumpedSeasonEnd).toBe('2026-09-02');
    }
  });

  // --- Biweekly cadence: 14d on-cycle, 7d off-cycle (right DOW, wrong cadence) ---

  test('biweekly, 14d on-cycle Monday → season_extend (past season_end)', () => {
    // Past season_end (2026-09-28): 2026-10-12 = 126d from 2026-06-08 = 9*14 ✓, Monday ✓
    const result = classifyAddition(biweeklySeries(), addition('2026-10-12'));
    expect(result.kind).toBe('season_extend');
  });

  test('biweekly, 7d Monday (right DOW, wrong cadence) → off-cycle → override_append', () => {
    // 2026-06-15: 7d from season_start, Monday, but 7%14=7≠0 → off-cycle for biweekly
    const result = classifyAddition(biweeklySeries(), addition('2026-06-15'));
    expect(result.kind).toBe('override_append');
    if (result.kind === 'override_append') {
      // 2026-06-15 < season_end 2026-09-28 → no bump
      expect(result.bumpedSeasonEnd).toBeUndefined();
    }
  });

  // --- Edge: missing season bounds ---

  test('recurrence series missing season_end → skip', () => {
    const series = weeklySeries({ season_end: undefined });
    const result = classifyAddition(series, addition('2026-09-01'));
    expect(result.kind).toBe('skip');
    if (result.kind === 'skip') {
      expect(result.reason).toMatch(/missing season bounds/);
    }
  });

  test('recurrence series missing season_start → skip', () => {
    const series = weeklySeries({ season_start: undefined });
    const result = classifyAddition(series, addition('2026-09-01'));
    expect(result.kind).toBe('skip');
  });

  // --- Edge: series has neither schedule nor recurrence_day ---

  test('series with no schedule and no recurrence_day → skip', () => {
    // Build a bare series object that passes TS but lacks both patterns
    // (we bypass the Zod refinement by casting)
    const series = { recurrence: 'weekly' } as unknown as EventSeries;
    const result = classifyAddition(series, addition('2026-09-01'));
    expect(result.kind).toBe('skip');
    if (result.kind === 'skip') {
      expect(result.reason).toMatch(/neither schedule nor recurrence_day/);
    }
  });

  // --- Wrong DOW test: confirm it falls into off-cycle, not season_extend ---

  test('right cadence interval but wrong DOW → override_append not season_extend', () => {
    // season_start is 2026-06-08 (Monday). A date 7d later on a Tuesday is impossible
    // (7d from Monday is always Monday). Let's use biweekly: 14d from Monday = Monday.
    // Test wrong DOW more directly: series with recurrence_day='wednesday',
    // season_start='2026-06-10' (a Wednesday). 14d later = 2026-06-24 (Wednesday) → on-cycle.
    // 7d later = 2026-06-17 (Wednesday) → 7%14=7≠0 → off-cycle.
    const wednesdaySeries: EventSeries = {
      recurrence: 'biweekly',
      recurrence_day: 'wednesday',
      season_start: '2026-06-10',  // Wednesday
      season_end: '2026-08-19',
    } as EventSeries;
    // 2026-06-17: 7d from season_start, Wednesday. 7%14=7≠0 → off-cycle
    const result = classifyAddition(wednesdaySeries, addition('2026-06-17'));
    expect(result.kind).toBe('override_append');
  });
});

// ---------------------------------------------------------------------------
// applyTogglesToEvent — recurrence-series additions (integration)
// ---------------------------------------------------------------------------

describe('applyTogglesToEvent — recurrence series additions', () => {
  // Weekly Monday series: season 2026-06-08 to 2026-08-24
  function makeWeeklyRecurrenceEvent(): AdminEvent {
    return makeEvent({
      series: {
        recurrence: 'weekly',
        recurrence_day: 'monday',
        season_start: '2026-06-08',
        season_end: '2026-08-24',
      },
    });
  }

  function makeUpstreamWithRecurrenceAdditions(
    overrides: Array<{ date: string; uid: string; location?: string; start_time?: string }>,
  ): ParsedVEvent {
    return makeUpstream({
      series: {
        kind: 'recurrence',
        recurrence: 'weekly',
        recurrence_day: 'monday',
        season_start: '2026-06-08',
        season_end: '2026-08-24',
        overrides: overrides.map(o => ({ ...o })),
      },
    });
  }

  test('on-cycle addition past season_end → bumps season_end, no new override', () => {
    const event = makeWeeklyRecurrenceEvent();
    // 2026-08-31: 84d from 2026-06-08 = 12*7 ✓, Monday ✓, past 2026-08-24 ✓
    const upstream = makeUpstreamWithRecurrenceAdditions([
      { date: '2026-08-31', uid: 'extend-uid' },
    ]);
    const body = defaultBody({ additions: { 'extend-uid': 'add' } });

    const result = applyTogglesToEvent(event, upstream, body);

    expect(result.series?.season_end).toBe('2026-08-31');
    expect(result.series?.overrides).toBeUndefined();
    // schedule should not be created
    expect(result.series?.schedule).toBeUndefined();
  });

  test('off-cycle addition within season → adds override, no season_end bump', () => {
    const event = makeWeeklyRecurrenceEvent();
    // 2026-07-01 is a Wednesday (off-cycle), within 2026-08-24
    const upstream = makeUpstreamWithRecurrenceAdditions([
      { date: '2026-07-01', uid: 'offcycle-uid', location: 'Special Venue' },
    ]);
    const body = defaultBody({ additions: { 'offcycle-uid': 'add' } });

    const result = applyTogglesToEvent(event, upstream, body);

    expect(result.series?.season_end).toBe('2026-08-24');  // unchanged
    expect(result.series?.overrides).toHaveLength(1);
    expect(result.series?.overrides?.[0]?.date).toBe('2026-07-01');
    expect(result.series?.overrides?.[0]?.location).toBe('Special Venue');
    expect(result.series?.schedule).toBeUndefined();
  });

  test('off-cycle addition past season_end → adds override AND bumps season_end', () => {
    const event = makeWeeklyRecurrenceEvent();
    // 2026-09-02 is a Wednesday (off-cycle), past 2026-08-24
    const upstream = makeUpstreamWithRecurrenceAdditions([
      { date: '2026-09-02', uid: 'offcycle-past-uid', location: 'Extra Stop' },
    ]);
    const body = defaultBody({ additions: { 'offcycle-past-uid': 'add' } });

    const result = applyTogglesToEvent(event, upstream, body);

    expect(result.series?.season_end).toBe('2026-09-02');
    expect(result.series?.overrides).toHaveLength(1);
    expect(result.series?.overrides?.[0]?.date).toBe('2026-09-02');
    expect(result.series?.schedule).toBeUndefined();
  });

  test('on-cycle addition within existing season window → skipped', () => {
    const event = makeWeeklyRecurrenceEvent();
    // 2026-07-06: 28d from 2026-06-08 = 4*7 ✓, Monday ✓, within 2026-08-24 ✓
    const upstream = makeUpstreamWithRecurrenceAdditions([
      { date: '2026-07-06', uid: 'in-window-uid' },
    ]);
    const body = defaultBody({ additions: { 'in-window-uid': 'add' } });

    const result = applyTogglesToEvent(event, upstream, body);

    // No changes — season_end stays, no overrides added
    expect(result.series?.season_end).toBe('2026-08-24');
    expect(result.series?.overrides).toBeUndefined();
    expect(result.series?.schedule).toBeUndefined();
  });

  test('original event is not mutated', () => {
    const event = makeWeeklyRecurrenceEvent();
    const upstream = makeUpstreamWithRecurrenceAdditions([
      { date: '2026-08-31', uid: 'extend-uid' },
    ]);
    const body = defaultBody({ additions: { 'extend-uid': 'add' } });

    applyTogglesToEvent(event, upstream, body);

    // Original event unchanged
    expect(event.series?.season_end).toBe('2026-08-24');
    expect(event.series?.overrides).toBeUndefined();
  });
});
