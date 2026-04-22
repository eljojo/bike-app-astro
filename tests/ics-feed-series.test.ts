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
