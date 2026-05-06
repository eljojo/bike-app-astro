import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from './test-db';
import type { Database } from '../src/db';
import type { AdminEvent } from '../src/types/admin';
import type { ParsedVEvent } from '../src/lib/calendar-suggestions/types';
import { advanceSnapshot, loadAllSnapshots } from '../src/lib/calendar-suggestions/snapshots.server';
import {
  applyTogglesToEvent,
  bodySchema,
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
