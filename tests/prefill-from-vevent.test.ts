import { describe, test, expect } from 'vitest';
import type { ParsedVEvent } from '../src/lib/calendar-suggestions/types';
import { buildCopyDataFromVevent } from '../src/lib/calendar-suggestions/prefill';

describe('buildCopyDataFromVevent', () => {
  test('one-off with time — date/time split', () => {
    const v: ParsedVEvent = {
      uid: 'oneoff@x',
      summary: 'Coffee Ride',
      start: '2026-05-10T18:00:00.000Z',
      end: '2026-05-10T20:00:00.000Z',
      location: 'Park',
      description: 'Easy 20km',
      url: 'https://example.com/e/1',
    };
    const cd = buildCopyDataFromVevent(v, 'qbc');
    expect(cd).toMatchObject({
      name: 'Coffee Ride',
      start_date: '2026-05-10',
      start_time: '18:00',
      end_date: '2026-05-10',
      end_time: '20:00',
      location: 'Park',
      body: 'Easy 20km',
      event_url: 'https://example.com/e/1',
      organizer: 'qbc',
      ics_uid: 'oneoff@x',
    });
    expect(cd.series).toBeUndefined();
  });

  test('all-day event (start has no time component)', () => {
    const v: ParsedVEvent = {
      uid: 'allday@x',
      summary: 'Community Day',
      start: '2026-06-12',
    };
    const cd = buildCopyDataFromVevent(v, 'qbc');
    expect(cd.start_date).toBe('2026-06-12');
    expect(cd.start_time).toBeUndefined();
    expect(cd.end_date).toBeUndefined();
    expect(cd.end_time).toBeUndefined();
  });

  test('series with clean recurrence — includes series block', () => {
    const v: ParsedVEvent = {
      uid: 'series@x',
      summary: 'Every Monday',
      start: '2026-05-04T18:00:00.000Z',
      series: {
        kind: 'recurrence',
        recurrence: 'weekly',
        recurrence_day: 'monday',
        season_start: '2026-05-04',
        season_end: '2026-09-28',
        skip_dates: ['2026-05-18'],
      },
    };
    const cd = buildCopyDataFromVevent(v, 'qbc');
    expect(cd.start_date).toBe('2026-05-04');       // season_start takes precedence for start_date
    expect(cd.start_time).toBe('18:00');
    expect(cd.ics_uid).toBe('series@x');
    expect(cd.series).toEqual({
      recurrence: 'weekly',
      recurrence_day: 'monday',
      season_start: '2026-05-04',
      season_end: '2026-09-28',
      skip_dates: ['2026-05-18'],
    });
    // Absent fields must not appear as explicit undefined keys — YAML would emit them as nulls.
    expect(Object.keys(cd.series as Record<string, unknown>)).not.toContain('overrides');
  });

  test('series with no EXDATE/overrides omits skip_dates/overrides entirely', () => {
    const v: ParsedVEvent = {
      uid: 'series-clean@x',
      summary: 'Every Monday',
      start: '2026-05-04T18:00:00.000Z',
      series: {
        kind: 'recurrence',
        recurrence: 'weekly',
        recurrence_day: 'monday',
        season_start: '2026-05-04',
        season_end: '2026-09-28',
      },
    };
    const cd = buildCopyDataFromVevent(v, 'qbc');
    const seriesKeys = Object.keys(cd.series as Record<string, unknown>);
    expect(seriesKeys).not.toContain('skip_dates');
    expect(seriesKeys).not.toContain('overrides');
    expect(seriesKeys.sort()).toEqual(['recurrence', 'recurrence_day', 'season_end', 'season_start']);
  });

  test('series with schedule fallback — includes schedule list', () => {
    const v: ParsedVEvent = {
      uid: 'sched@x',
      summary: 'First Sunday',
      start: '2026-05-03T10:00:00.000Z',
      series: {
        kind: 'schedule',
        schedule: [
          { date: '2026-05-03', start_time: '10:00' },
          { date: '2026-06-07', start_time: '10:00' },
        ],
      },
    };
    const cd = buildCopyDataFromVevent(v, 'qbc');
    expect(cd.series).toEqual({
      schedule: [
        { date: '2026-05-03', start_time: '10:00' },
        { date: '2026-06-07', start_time: '10:00' },
      ],
    });
    // schedule-series also has season_start? probably not — fall back to slicing start
    expect(cd.start_date).toBe('2026-05-03');
  });
});
