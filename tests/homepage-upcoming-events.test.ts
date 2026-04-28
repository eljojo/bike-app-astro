import { describe, it, expect } from 'vitest';
import { getUpcomingEvents } from '../src/lib/homepage-data.server';
import type { CollectionEntry } from 'astro:content';

type EventEntry = CollectionEntry<'events'>;
type OrganizerEntry = CollectionEntry<'organizers'>;

// Helper to build a minimal event entry with the typed shape getCollection
// would produce. Cast through unknown so tests don't need every optional
// field on the live schema.
function makeEvent(id: string, data: Record<string, unknown>): EventEntry {
  return { id, data, body: '' } as unknown as EventEntry;
}

const ORGS: OrganizerEntry[] = [];

// Fixture mirroring ottawa/events/2026/ottbike-social-spring.md — weekly
// Thursday recurrence, season 2026-04-16 → 2026-06-25. The event has
// start_date and end_date that span the whole season; without nextDate the
// renderer would show "April 16 – June 25, 2026", which is ambiguous about
// when the next ride actually happens.
const OTTBIKE = makeEvent('2026/ottbike-social-spring', {
  name: 'OttBike Social - Spring Calendar',
  start_date: '2026-04-16',
  end_date: '2026-06-25',
  series: {
    recurrence: 'weekly',
    recurrence_day: 'thursday',
    season_start: '2026-04-16',
    season_end: '2026-06-25',
  },
});

const ONEOFF_APR_29 = makeEvent('2026/bike-minds', {
  name: 'Bike Minds - April 2026',
  start_date: '2026-04-29',
});

const SCHEDULE_SERIES = makeEvent('2026/ldw-spring-rally', {
  name: 'LDW Spring Rally',
  start_date: '2026-04-24',
  end_date: '2026-05-17',
  series: {
    schedule: [
      { date: '2026-04-24' },
      { date: '2026-05-01' },
      { date: '2026-05-17' },
    ],
  },
});

describe('getUpcomingEvents — series events show next occurrence, not season range', () => {
  it('weekly-recurrence series sets nextDate to the next Thursday on/after today', () => {
    // Tuesday Apr 28 — next Thursday is Apr 30
    const today = new Date('2026-04-28T14:00:00');
    const [event] = getUpcomingEvents([OTTBIKE], ORGS, today);
    expect(event.slug).toBe('2026/ottbike-social-spring');
    expect(event.nextDate).toBe('2026-04-30');
    expect(event.startDate).toBe('2026-04-16');
    expect(event.endDate).toBe('2026-06-25');
  });

  it('schedule-based series sets nextDate to the next scheduled date', () => {
    // Apr 26 — next scheduled date is May 1
    const today = new Date('2026-04-26T14:00:00');
    const [event] = getUpcomingEvents([SCHEDULE_SERIES], ORGS, today);
    expect(event.nextDate).toBe('2026-05-01');
  });

  it('today still counts as the next occurrence (end-of-day boundary)', () => {
    // Thursday Apr 30, mid-day — Apr 30 is itself an occurrence, must be picked
    const today = new Date('2026-04-30T14:00:00');
    const [event] = getUpcomingEvents([OTTBIKE], ORGS, today);
    expect(event.nextDate).toBe('2026-04-30');
  });

  it('series with all past occurrences is filtered out of upcoming', () => {
    // After season_end — no future occurrences
    const today = new Date('2026-07-01T00:00:00');
    expect(getUpcomingEvents([OTTBIKE], ORGS, today)).toEqual([]);
  });

  it('one-off events have no nextDate', () => {
    const today = new Date('2026-04-28T14:00:00');
    const [event] = getUpcomingEvents([ONEOFF_APR_29], ORGS, today);
    expect(event.nextDate).toBeUndefined();
    expect(event.startDate).toBe('2026-04-29');
  });
});

describe('getUpcomingEvents — sort uses next occurrence, not start_date', () => {
  it('a series whose next ride is later than a one-off comes after the one-off', () => {
    // Today: Tue Apr 28. OttBike next: Thu Apr 30. Bike Minds: Wed Apr 29.
    // start_date alone would put OttBike (Apr 16) first; the new sort uses the
    // effective next-occurrence date, which puts Apr 29 before Apr 30.
    const today = new Date('2026-04-28T14:00:00');
    const result = getUpcomingEvents([OTTBIKE, ONEOFF_APR_29], ORGS, today);
    expect(result.map(e => e.slug)).toEqual([
      '2026/bike-minds',
      '2026/ottbike-social-spring',
    ]);
  });
});
