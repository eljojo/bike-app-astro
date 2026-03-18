import { describe, it, expect } from 'vitest';
import { expandSeriesOccurrences, getNextOccurrence, isSeriesActive, isSeriesEvent } from '../../src/lib/series-utils';

describe('expandSeriesOccurrences', () => {
  it('returns empty for non-series event', () => {
    const event = { name: 'One-off', start_date: '2026-06-01' };
    expect(expandSeriesOccurrences(event as any)).toEqual([]);
  });

  it('expands weekly recurrence', () => {
    const event = {
      name: 'Park Loops',
      start_time: '18:00',
      location: 'P3',
      series: {
        recurrence: 'weekly',
        recurrence_day: 'tuesday',
        season_start: '2026-06-02', // a Tuesday
        season_end: '2026-06-23',
      },
    };
    const result = expandSeriesOccurrences(event as any);
    expect(result).toHaveLength(4);
    expect(result.map(r => r.date)).toEqual([
      '2026-06-02', '2026-06-09', '2026-06-16', '2026-06-23',
    ]);
    expect(result[0].location).toBe('P3');
    expect(result[0].start_time).toBe('18:00');
  });

  it('expands biweekly recurrence', () => {
    const event = {
      name: 'Social',
      series: {
        recurrence: 'biweekly',
        recurrence_day: 'thursday',
        season_start: '2026-01-08', // a Thursday
        season_end: '2026-02-19',
      },
    };
    const result = expandSeriesOccurrences(event as any);
    expect(result.map(r => r.date)).toEqual([
      '2026-01-08', '2026-01-22', '2026-02-05', '2026-02-19',
    ]);
  });

  it('skips dates in skip_dates', () => {
    const event = {
      name: 'Ride',
      series: {
        recurrence: 'weekly',
        recurrence_day: 'tuesday',
        season_start: '2026-06-02',
        season_end: '2026-06-23',
        skip_dates: ['2026-06-09'],
      },
    };
    const result = expandSeriesOccurrences(event as any);
    expect(result).toHaveLength(3);
    expect(result.map(r => r.date)).not.toContain('2026-06-09');
  });

  it('applies overrides', () => {
    const event = {
      name: 'Ride',
      location: 'Park A',
      series: {
        recurrence: 'weekly',
        recurrence_day: 'tuesday',
        season_start: '2026-06-02',
        season_end: '2026-06-16',
        overrides: [
          { date: '2026-06-09', location: 'Park B', note: 'Special' },
        ],
      },
    };
    const result = expandSeriesOccurrences(event as any);
    expect(result[1].location).toBe('Park B');
    expect(result[1].note).toBe('Special');
    expect(result[0].location).toBe('Park A');
  });

  it('handles cancelled occurrences', () => {
    const event = {
      name: 'Ride',
      series: {
        recurrence: 'weekly',
        recurrence_day: 'tuesday',
        season_start: '2026-06-02',
        season_end: '2026-06-16',
        overrides: [{ date: '2026-06-09', cancelled: true }],
      },
    };
    const result = expandSeriesOccurrences(event as any);
    expect(result[1].cancelled).toBe(true);
  });

  it('handles rescheduled dates (extra date not on cadence)', () => {
    const event = {
      name: 'Ride',
      location: 'Park',
      series: {
        recurrence: 'weekly',
        recurrence_day: 'tuesday',
        season_start: '2026-06-02',
        season_end: '2026-06-09',
        skip_dates: ['2026-06-09'],
        overrides: [
          { date: '2026-06-11', rescheduled_from: '2026-06-09', note: 'Moved to Thursday' },
        ],
      },
    };
    const result = expandSeriesOccurrences(event as any);
    expect(result.map(r => r.date)).toEqual(['2026-06-02', '2026-06-11']);
    expect(result[1].rescheduled_from).toBe('2026-06-09');
  });
});

describe('expandSeriesOccurrences — explicit schedule', () => {
  it('uses schedule entries directly', () => {
    const event = {
      name: 'Social',
      start_time: '19:00',
      meet_time: '18:45',
      location: 'Default',
      series: {
        schedule: [
          { date: '2026-01-08', location: 'Overbrook CC' },
          { date: '2026-01-22', location: 'Hintonburg CC' },
        ],
      },
    };
    const result = expandSeriesOccurrences(event as any);
    expect(result).toHaveLength(2);
    expect(result[0].location).toBe('Overbrook CC');
    expect(result[0].start_time).toBe('19:00');
    expect(result[0].meet_time).toBe('18:45');
    expect(result[1].location).toBe('Hintonburg CC');
  });

  it('falls back to event location when schedule entry omits it', () => {
    const event = {
      name: 'Social',
      location: 'Default Park',
      series: {
        schedule: [
          { date: '2026-01-08' },
        ],
      },
    };
    const result = expandSeriesOccurrences(event as any);
    expect(result[0].location).toBe('Default Park');
  });
});

describe('getNextOccurrence', () => {
  it('returns next non-cancelled occurrence after now', () => {
    const occurrences = [
      { date: '2026-06-02' },
      { date: '2026-06-09', cancelled: true },
      { date: '2026-06-16' },
    ];
    const now = new Date(2026, 5, 5); // June 5
    expect(getNextOccurrence(occurrences, now)?.date).toBe('2026-06-16');
  });

  it('returns undefined when all past', () => {
    const occurrences = [{ date: '2020-01-01' }];
    expect(getNextOccurrence(occurrences, new Date())).toBeUndefined();
  });
});

describe('isSeriesActive', () => {
  it('returns true when future occurrences exist', () => {
    const occurrences = [{ date: '2099-01-01' }];
    expect(isSeriesActive(occurrences, new Date())).toBe(true);
  });

  it('returns false when all past', () => {
    const occurrences = [{ date: '2020-01-01' }];
    expect(isSeriesActive(occurrences, new Date())).toBe(false);
  });
});

describe('isSeriesEvent', () => {
  it('returns true when series field present', () => {
    expect(isSeriesEvent({ series: { schedule: [] } })).toBe(true);
  });

  it('returns false when no series field', () => {
    expect(isSeriesEvent({})).toBe(false);
  });

  it('returns false for null series', () => {
    expect(isSeriesEvent({ series: null })).toBe(false);
  });
});
