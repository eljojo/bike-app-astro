import { describe, it, expect } from 'vitest';
import {
  buildPageviewsSeries,
  buildAvgDurationSeries,
  buildTotalDurationSeries,
  buildPagesPerVisitSeries,
} from '../../src/lib/stats/types';

describe('buildPageviewsSeries', () => {
  it('returns an empty array for empty input', () => {
    expect(buildPageviewsSeries([])).toEqual([]);
  });

  it('projects pageviews and visitors', () => {
    const daily = [
      { date: '2026-04-01', pageviews: 100, visitors: 40 },
      { date: '2026-04-02', pageviews: 120, visitors: 50 },
    ];
    expect(buildPageviewsSeries(daily)).toEqual([
      { date: '2026-04-01', value: 100, secondaryValue: 40 },
      { date: '2026-04-02', value: 120, secondaryValue: 50 },
    ]);
  });

  it('coalesces nullable visitors to 0', () => {
    const daily = [{ date: '2026-04-01', pageviews: 100, visitors: null }];
    expect(buildPageviewsSeries(daily)).toEqual([
      { date: '2026-04-01', value: 100, secondaryValue: 0 },
    ]);
  });
});

describe('buildAvgDurationSeries', () => {
  it('rounds avgDuration to integer seconds', () => {
    const daily = [{ date: '2026-04-01', avgDuration: 123.7 }];
    expect(buildAvgDurationSeries(daily)).toEqual([
      { date: '2026-04-01', value: 124 },
    ]);
  });

  it('coalesces missing avgDuration to 0', () => {
    const daily = [{ date: '2026-04-01', avgDuration: null }];
    expect(buildAvgDurationSeries(daily)).toEqual([
      { date: '2026-04-01', value: 0 },
    ]);
  });
});

describe('buildTotalDurationSeries', () => {
  it('rounds totalDurationS to integer', () => {
    const daily = [{ date: '2026-04-01', totalDurationS: 12345.6 }];
    expect(buildTotalDurationSeries(daily)).toEqual([
      { date: '2026-04-01', value: 12346 },
    ]);
  });
});

describe('buildPagesPerVisitSeries', () => {
  it('computes pages-per-visit rounded to 1dp', () => {
    const daily = [{ date: '2026-04-01', pageviews: 100, visitors: 40 }];
    expect(buildPagesPerVisitSeries(daily)).toEqual([
      { date: '2026-04-01', value: 2.5 },
    ]);
  });

  it('returns 0 when visitors is 0 (no division-by-zero NaN)', () => {
    const daily = [{ date: '2026-04-01', pageviews: 100, visitors: 0 }];
    expect(buildPagesPerVisitSeries(daily)).toEqual([
      { date: '2026-04-01', value: 0 },
    ]);
  });
});
