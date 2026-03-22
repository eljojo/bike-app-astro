import { describe, it, expect } from 'vitest';
import { computeInsights, computeMedians, type EngagementRow } from '../../src/lib/stats/insights';

function makeRow(overrides: Partial<EngagementRow>): EngagementRow {
  return {
    contentType: 'route',
    contentSlug: 'test-route',
    totalPageviews: 100,
    totalVisitorDays: 80,
    avgVisitDuration: 120,
    avgBounceRate: 40,
    stars: 5,
    videoPlayRate: 0,
    mapConversionRate: 0.25,
    wallTimeHours: 3.3,
    engagementScore: 0.5,
    ...overrides,
  };
}

describe('computeMedians', () => {
  it('computes medians for a set of rows', () => {
    const rows = [
      makeRow({ totalPageviews: 10, avgVisitDuration: 60 }),
      makeRow({ totalPageviews: 100, avgVisitDuration: 120 }),
      makeRow({ totalPageviews: 1000, avgVisitDuration: 180 }),
    ];
    const medians = computeMedians(rows);
    expect(medians.totalPageviews).toBe(100);
    expect(medians.avgVisitDuration).toBe(120);
  });
});

describe('computeInsights', () => {
  it('detects a hidden gem', () => {
    const rows = [
      makeRow({ contentSlug: 'hidden', totalPageviews: 20, avgVisitDuration: 300, wallTimeHours: 1.7 }),
      makeRow({ contentSlug: 'normal1', totalPageviews: 100, avgVisitDuration: 120 }),
      makeRow({ contentSlug: 'normal2', totalPageviews: 200, avgVisitDuration: 100 }),
    ];
    const medians = computeMedians(rows);
    const insights = computeInsights(rows, medians);
    const hiddenGem = insights.find(i => i.type === 'hidden-gem');
    expect(hiddenGem).toBeDefined();
    expect(hiddenGem!.contentSlug).toBe('hidden');
  });

  it('detects needs-work content', () => {
    const rows = [
      makeRow({ contentSlug: 'bad', totalPageviews: 500, avgVisitDuration: 30, avgBounceRate: 80, stars: 0 }),
      makeRow({ contentSlug: 'normal1', totalPageviews: 100, avgVisitDuration: 120, avgBounceRate: 40, stars: 5 }),
      makeRow({ contentSlug: 'normal2', totalPageviews: 50, avgVisitDuration: 150, avgBounceRate: 30, stars: 8 }),
    ];
    const medians = computeMedians(rows);
    const insights = computeInsights(rows, medians);
    const needsWork = insights.find(i => i.type === 'needs-work');
    expect(needsWork).toBeDefined();
    expect(needsWork!.contentSlug).toBe('bad');
  });

  it('returns at most one insight per content item (highest priority)', () => {
    const rows = [
      makeRow({ contentSlug: 'multi', totalPageviews: 20, avgVisitDuration: 300, engagementScore: 0.95 }),
      makeRow({ contentSlug: 'filler1', totalPageviews: 100, avgVisitDuration: 120 }),
      makeRow({ contentSlug: 'filler2', totalPageviews: 200, avgVisitDuration: 100 }),
    ];
    const medians = computeMedians(rows);
    const insights = computeInsights(rows, medians);
    const forMulti = insights.filter(i => i.contentSlug === 'multi');
    expect(forMulti.length).toBe(1);
  });
});
