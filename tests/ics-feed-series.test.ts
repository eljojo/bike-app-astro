import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseIcs } from '../src/lib/external/ics-feed.server';

function fixture(name: string): string {
  return readFileSync(path.join('tests/fixtures/ics', name), 'utf-8');
}

const TORONTO = 'America/Toronto';

describe('parseIcs — series with clean RRULE', () => {
  test('weekly with UNTIL maps to recurrence pattern', () => {
    const feed = parseIcs(fixture('series-weekly-until.ics'), 'https://example.com/feed.ics', TORONTO);
    expect(feed.events).toHaveLength(1);
    const e = feed.events[0];
    expect(e.uid).toBe('test-weekly@example.com');
    expect(e.series).toBeDefined();
    expect(e.series!.kind).toBe('recurrence');
    expect(e.series!.recurrence).toBe('weekly');
    expect(e.series!.recurrence_day).toBe('monday');
    // DTSTART:20260504T180000Z = 14:00 EDT same day in Toronto.
    expect(e.series!.season_start).toBe('2026-05-04');
    // UNTIL=20260928T000000Z = 2026-09-27T20:00 EDT — the local calendar date is Sep 27,
    // not Sep 28. The series effectively ends on Sep 21 (the last Monday before the cutoff)
    // but season_end is just the projection of UNTIL into siteTz.
    expect(e.series!.season_end).toBe('2026-09-27');
    expect(e.series!.skip_dates ?? []).toHaveLength(0);
  });

  test('biweekly with COUNT computes season_end', () => {
    const feed = parseIcs(fixture('series-biweekly-count.ics'), 'https://example.com/feed.ics', TORONTO);
    const e = feed.events[0];
    expect(e.series!.kind).toBe('recurrence');
    expect(e.series!.recurrence).toBe('biweekly');
    expect(e.series!.recurrence_day).toBe('thursday');
    expect(e.series!.season_start).toBe('2026-05-07');
    // 10 occurrences at 2-week interval: last occurrence = season_start + 18 weeks.
    expect(e.series!.season_end).toBe('2026-09-10');
  });

  test('EXDATE entries become skip_dates', () => {
    const feed = parseIcs(fixture('series-weekly-exdate.ics'), 'https://example.com/feed.ics', TORONTO);
    const e = feed.events[0];
    expect(e.series!.skip_dates).toEqual(['2026-05-18', '2026-06-01']);
  });

  test('comma-separated EXDATE values on a single line all become skip_dates', () => {
    // RFC 5545 allows multi-value EXDATE: `EXDATE:20260518T180000Z,20260601T180000Z,...`
    // Google Calendar emits this form. The parser must iterate every value, not
    // just the first. (Regression guard: ical.js's getFirstValue() returns only one.)
    const feed = parseIcs(fixture('series-weekly-exdate-multi.ics'), 'https://example.com/feed.ics', TORONTO);
    const e = feed.events[0];
    expect(e.series!.skip_dates).toEqual(['2026-05-18', '2026-06-01', '2026-06-15']);
  });
});

describe('parseIcs — series with TZID', () => {
  test('weekly TZID series projects season, EXDATE, and overrides through siteTz', () => {
    // Source authored in America/Toronto, siteTz=America/Toronto. The projection
    // is the identity for this case but exercises every code path: season_start
    // from DTSTART, season_end from UNTIL, EXDATE → skip_dates, RECURRENCE-ID
    // → overrides. UTC formatting would have shifted late-evening events past
    // midnight to the next calendar day.
    const feed = parseIcs(fixture('series-weekly-tzid.ics'), 'https://example.com/feed.ics', TORONTO);
    const e = feed.events[0];
    expect(e.uid).toBe('test-weekly-tzid@example.com');

    // Base event start/end: naive site-local clock (no offset, no Z).
    expect(e.start).toBe('2026-05-05T19:30:00');
    expect(e.end).toBe('2026-05-05T21:30:00');

    expect(e.series!.season_start).toBe('2026-05-05');
    // UNTIL=20260929T035959Z = 2026-09-28T23:59:59 EDT → '2026-09-28' (vs UTC '2026-09-29').
    expect(e.series!.season_end).toBe('2026-09-28');

    // EXDATEs authored as TZID=America/Toronto:…T193000. Both fall on Tuesday
    // in their local TZ; UTC formatting would have shifted them to Wednesday.
    expect(e.series!.skip_dates).toEqual(['2026-05-19', '2026-06-02']);

    // RECURRENCE-ID override: the 2026-05-26 occurrence rescheduled to 20:30.
    expect(e.series!.overrides).toHaveLength(1);
    expect(e.series!.overrides![0]).toMatchObject({
      date: '2026-05-26',
      start_time: '20:30',
      location: 'Riverside',
    });
  });
});

describe('parseIcs — schedule fallback', () => {
  test('monthly RRULE falls back to explicit schedule', () => {
    const feed = parseIcs(fixture('series-monthly.ics'), 'https://example.com/feed.ics', TORONTO);
    const e = feed.events[0];
    expect(e.series).toBeDefined();
    expect(e.series!.kind).toBe('schedule');
    expect(e.series!.schedule).toBeDefined();
    // First Sundays from 2026-05-03 through 2026-12-06 inclusive = 8 dates
    expect(e.series!.schedule!.length).toBeGreaterThanOrEqual(7);
    expect(e.series!.schedule![0].date).toBe('2026-05-03');
  });

  test('weekly with multiple BYDAY falls back to schedule', () => {
    const feed = parseIcs(fixture('series-multi-byday.ics'), 'https://example.com/feed.ics', TORONTO);
    const e = feed.events[0];
    expect(e.series!.kind).toBe('schedule');
    // 8 weeks × 3 days/week = 24 occurrences between 2026-05-04 and 2026-06-30 inclusive
    expect(e.series!.schedule!.length).toBeGreaterThan(20);
  });

  test('schedule fallback applies RECURRENCE-ID overrides (cancelled + moved)', () => {
    // ical.js's master.iterator() honors EXDATE but NOT RECURRENCE-ID
    // overrides. The fallback must reconcile cancelled and moved instances.
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//EN',
      'BEGIN:VEVENT',
      'UID:monthly-with-overrides@example.com',
      'DTSTAMP:20260101T120000Z',
      'DTSTART:20260105T140000Z',
      'DTEND:20260105T160000Z',
      'SUMMARY:First Sunday',
      'RRULE:FREQ=MONTHLY;BYDAY=1SU',
      'LOCATION:Park',
      'END:VEVENT',
      // Cancel the 2026-06-07 occurrence.
      'BEGIN:VEVENT',
      'UID:monthly-with-overrides@example.com',
      'DTSTAMP:20260101T120000Z',
      'DTSTART:20260607T140000Z',
      'DTEND:20260607T160000Z',
      'SUMMARY:First Sunday',
      'RECURRENCE-ID:20260607T140000Z',
      'STATUS:CANCELLED',
      'END:VEVENT',
      // Move the 2026-08-02 occurrence to 2026-08-09 with a different time and location.
      'BEGIN:VEVENT',
      'UID:monthly-with-overrides@example.com',
      'DTSTAMP:20260101T120000Z',
      'DTSTART:20260809T160000Z',
      'DTEND:20260809T180000Z',
      'SUMMARY:First Sunday — moved',
      'RECURRENCE-ID:20260802T140000Z',
      'LOCATION:Library',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const now = new Date('2026-04-21T00:00:00Z');
    const feed = parseIcs(text, 'https://example.com/feed.ics', TORONTO, now);
    const sched = feed.events[0].series!.schedule!;
    const dates = sched.map(s => s.date);
    // 2026-06-07 cancelled — should not appear.
    expect(dates).not.toContain('2026-06-07');
    // 2026-08-02 moved to 2026-08-09 — original date gone, new date present.
    expect(dates).not.toContain('2026-08-02');
    expect(dates).toContain('2026-08-09');
    const moved = sched.find(s => s.date === '2026-08-09')!;
    expect(moved.location).toBe('Library');
    // 16:00 UTC on 2026-08-09 = 12:00 EDT
    expect(moved.start_time).toBe('12:00');
  });

  test('schedule for a long-running series anchors near `now`, not master DTSTART', () => {
    // A monthly group ride that has been running since 2020. Iterating from
    // master.startDate and stopping after 365 days would yield only 2020-2021
    // dates; the suggestion would silently disappear once `nowDate` passed
    // 2021. The schedule must be anchored to `now`.
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//EN',
      'BEGIN:VEVENT',
      'UID:long-running-monthly@example.com',
      'DTSTAMP:20200103T120000Z',
      'DTSTART:20200105T140000Z',
      'DTEND:20200105T160000Z',
      'SUMMARY:First Sunday since 2020',
      'RRULE:FREQ=MONTHLY;BYDAY=1SU',
      'LOCATION:Park',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const now = new Date('2026-04-21T00:00:00Z');
    const feed = parseIcs(text, 'https://example.com/feed.ics', TORONTO, now);
    const e = feed.events[0];
    expect(e.series!.kind).toBe('schedule');
    const sched = e.series!.schedule!;
    expect(sched.length).toBeGreaterThanOrEqual(11);  // ~12 monthly occurrences in a year
    // Every entry must be on or after `now` and no later than now+365d.
    expect(sched[0].date >= '2026-04-21').toBe(true);
    expect(sched[sched.length - 1].date <= '2027-04-22').toBe(true);
    // Anchored monthly rule: every entry is the first Sunday of its month.
    for (const s of sched) {
      const d = new Date(`${s.date}T12:00:00Z`);
      expect(d.getUTCDay()).toBe(0);                  // Sunday
      expect(d.getUTCDate()).toBeLessThanOrEqual(7);  // first week of the month
    }
  });
});
