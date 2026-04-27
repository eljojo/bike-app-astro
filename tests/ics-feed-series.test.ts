import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseIcs } from '../src/lib/external/ics-feed.server';

function fixture(name: string): string {
  return readFileSync(path.join('tests/fixtures/ics', name), 'utf-8');
}

describe('parseIcs — series with clean RRULE', () => {
  test('weekly with UNTIL maps to recurrence pattern', () => {
    const feed = parseIcs(fixture('series-weekly-until.ics'), 'https://example.com/feed.ics');
    expect(feed.events).toHaveLength(1);
    const e = feed.events[0];
    expect(e.uid).toBe('test-weekly@example.com');
    expect(e.series).toBeDefined();
    expect(e.series!.kind).toBe('recurrence');
    expect(e.series!.recurrence).toBe('weekly');
    expect(e.series!.recurrence_day).toBe('monday');
    expect(e.series!.season_start).toBe('2026-05-04');
    expect(e.series!.season_end).toBe('2026-09-28');
    expect(e.series!.skip_dates ?? []).toHaveLength(0);
  });

  test('biweekly with COUNT computes season_end', () => {
    const feed = parseIcs(fixture('series-biweekly-count.ics'), 'https://example.com/feed.ics');
    const e = feed.events[0];
    expect(e.series!.kind).toBe('recurrence');
    expect(e.series!.recurrence).toBe('biweekly');
    expect(e.series!.recurrence_day).toBe('thursday');
    expect(e.series!.season_start).toBe('2026-05-07');
    // 10 occurrences at 2-week interval: last occurrence = season_start + 18 weeks
    expect(e.series!.season_end).toBe('2026-09-10');
  });

  test('EXDATE entries become skip_dates', () => {
    const feed = parseIcs(fixture('series-weekly-exdate.ics'), 'https://example.com/feed.ics');
    const e = feed.events[0];
    expect(e.series!.skip_dates).toEqual(['2026-05-18', '2026-06-01']);
  });
});

describe('parseIcs — series with TZID', () => {
  test('weekly TZID series renders season, EXDATE, and RECURRENCE-ID overrides in local time', () => {
    // Regression: every formatter inside mapSeries used UTC getters, so a Toronto
    // series authored at 19:30 EDT was reported with UTC dates/times. Near midnight
    // or at DST boundaries the calendar date itself drifted by a day. Fix: extract
    // local clock parts via Intl in DTSTART's TZID for all of season_start/season_end/
    // skip_dates/overrides + the schedule fallback.
    const feed = parseIcs(fixture('series-weekly-tzid.ics'), 'https://example.com/feed.ics');
    const e = feed.events[0];
    expect(e.uid).toBe('test-weekly-tzid@example.com');

    // start/end on the base event: local clock + EDT offset
    expect(e.start).toBe('2026-05-05T19:30:00-04:00');
    expect(e.end).toBe('2026-05-05T21:30:00-04:00');

    // season_start: from DTSTART, in local TZ (would be 2026-05-05 in either UTC
    // or local for this case — but the regression is documented for the EXDATEs below).
    expect(e.series!.season_start).toBe('2026-05-05');
    // season_end: UNTIL=20260929T035959Z is 2026-09-28T23:59:59 EDT — UTC formatting
    // would have given '2026-09-29' (the day after); local formatting gives the
    // calendar date the user actually meant.
    expect(e.series!.season_end).toBe('2026-09-28');

    // skip_dates: EXDATEs were authored as TZID=America/Toronto:…T193000.
    // Both fall on Tuesdays in their local TZ; UTC would have shifted to Wednesday.
    expect(e.series!.skip_dates).toEqual(['2026-05-19', '2026-06-02']);

    // RECURRENCE-ID override: the second VEVENT reschedules the 2026-05-26 occurrence
    // to 20:30 instead of 19:30, location moved to Riverside. Date and time both
    // expressed in DTSTART's TZ — UTC formatting would lose this for late-evening
    // events that wrap past midnight UTC.
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
    const feed = parseIcs(fixture('series-monthly.ics'), 'https://example.com/feed.ics');
    const e = feed.events[0];
    expect(e.series).toBeDefined();
    expect(e.series!.kind).toBe('schedule');
    expect(e.series!.schedule).toBeDefined();
    // First Sundays from 2026-05-03 through 2026-12-06 inclusive = 8 dates
    expect(e.series!.schedule!.length).toBeGreaterThanOrEqual(7);
    expect(e.series!.schedule![0].date).toBe('2026-05-03');
  });

  test('weekly with multiple BYDAY falls back to schedule', () => {
    const feed = parseIcs(fixture('series-multi-byday.ics'), 'https://example.com/feed.ics');
    const e = feed.events[0];
    expect(e.series!.kind).toBe('schedule');
    // 8 weeks × 3 days/week = 24 occurrences between 2026-05-04 and 2026-06-30 inclusive
    expect(e.series!.schedule!.length).toBeGreaterThan(20);
  });
});
