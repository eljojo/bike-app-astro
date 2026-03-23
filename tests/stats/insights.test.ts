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
    const names = { 'route:hidden': 'Hidden Trail' };
    const medians = computeMedians(rows);
    const insights = computeInsights(rows, medians, names);
    const hiddenGem = insights.find(i => i.type === 'hidden-gem');
    expect(hiddenGem).toBeDefined();
    expect(hiddenGem!.contentSlug).toBe('hidden');
    expect(hiddenGem!.name).toBe('Hidden Trail');
    expect(hiddenGem!.metrics).toBeDefined();
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

  it('does not flag pages with very few views as hidden gems', () => {
    const rows = [
      makeRow({ contentSlug: 'tiny', totalPageviews: 3, avgVisitDuration: 300 }),
      makeRow({ contentSlug: 'normal1', totalPageviews: 100, avgVisitDuration: 120 }),
      makeRow({ contentSlug: 'normal2', totalPageviews: 200, avgVisitDuration: 100 }),
    ];
    const medians = computeMedians(rows);
    const insights = computeInsights(rows, medians);
    const gem = insights.find(i => i.type === 'hidden-gem' && i.contentSlug === 'tiny');
    expect(gem).toBeUndefined();
  });

  it('does not flag pages with very short duration as hidden gems', () => {
    const rows = [
      makeRow({ contentSlug: 'short', totalPageviews: 50, avgVisitDuration: 7 }),
      makeRow({ contentSlug: 'normal1', totalPageviews: 100, avgVisitDuration: 3 }),
      makeRow({ contentSlug: 'normal2', totalPageviews: 200, avgVisitDuration: 2 }),
    ];
    const medians = computeMedians(rows);
    const insights = computeInsights(rows, medians);
    const gem = insights.find(i => i.type === 'hidden-gem' && i.contentSlug === 'short');
    expect(gem).toBeUndefined();
  });

  it('does not flag pages with very few views as strong performers', () => {
    const rows = [
      makeRow({ contentSlug: 'tiny-strong', totalPageviews: 3, engagementScore: 0.99 }),
      makeRow({ contentSlug: 'filler1', totalPageviews: 100, engagementScore: 0.3 }),
      makeRow({ contentSlug: 'filler2', totalPageviews: 200, engagementScore: 0.2 }),
    ];
    const medians = computeMedians(rows);
    const insights = computeInsights(rows, medians);
    const strong = insights.find(i => i.type === 'strong-performer' && i.contentSlug === 'tiny-strong');
    expect(strong).toBeUndefined();
  });

  it('strong performer narrative includes specific signals', () => {
    const rows = [
      makeRow({ contentSlug: 'star-route', totalPageviews: 500, engagementScore: 0.99, wallTimeHours: 30, mapConversionRate: 0.5, stars: 5 }),
      makeRow({ contentSlug: 'filler1', totalPageviews: 100, engagementScore: 0.3 }),
      makeRow({ contentSlug: 'filler2', totalPageviews: 200, engagementScore: 0.2 }),
    ];
    const medians = computeMedians(rows);
    const insights = computeInsights(rows, medians);
    const strong = insights.find(i => i.type === 'strong-performer');
    expect(strong).toBeDefined();
    expect(strong!.body).toContain('30h');
    expect(strong!.body).toContain('50%');
    expect(strong!.body).toContain('5 stars');
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

  it('detects trending content (30%+ growth)', () => {
    const rows = [
      makeRow({ contentSlug: 'growing', totalPageviews: 200, currentPeriodPageviews: 200, previousPeriodPageviews: 100 }),
      makeRow({ contentSlug: 'filler1', totalPageviews: 100 }),
      makeRow({ contentSlug: 'filler2', totalPageviews: 200 }),
    ];
    const medians = computeMedians(rows);
    const insights = computeInsights(rows, medians);
    const trending = insights.find(i => i.type === 'trending');
    expect(trending).toBeDefined();
    expect(trending!.contentSlug).toBe('growing');
    expect(trending!.body).toBe('100% more views than the previous period.');
  });

  it('detects declining content (30%+ drop)', () => {
    const rows = [
      makeRow({ contentSlug: 'shrinking', totalPageviews: 50, currentPeriodPageviews: 50, previousPeriodPageviews: 200 }),
      makeRow({ contentSlug: 'filler1', totalPageviews: 100 }),
      makeRow({ contentSlug: 'filler2', totalPageviews: 200 }),
    ];
    const medians = computeMedians(rows);
    const insights = computeInsights(rows, medians);
    const declining = insights.find(i => i.type === 'declining');
    expect(declining).toBeDefined();
    expect(declining!.contentSlug).toBe('shrinking');
    expect(declining!.body).toBe('75% fewer views than the previous period.');
  });

  it('does not trigger trending with fewer than 20 views in either period', () => {
    const rows = [
      makeRow({ contentSlug: 'tiny-trend', totalPageviews: 15, currentPeriodPageviews: 15, previousPeriodPageviews: 5 }),
      makeRow({ contentSlug: 'filler1', totalPageviews: 100 }),
      makeRow({ contentSlug: 'filler2', totalPageviews: 200 }),
    ];
    const medians = computeMedians(rows);
    const insights = computeInsights(rows, medians);
    const trending = insights.find(i => i.type === 'trending' && i.contentSlug === 'tiny-trend');
    expect(trending).toBeUndefined();
  });

  it('detects seasonal pattern with monthly data', () => {
    // Peak in July (index 6), trough in January (index 0)
    const monthly = [10, 15, 20, 25, 30, 40, 100, 80, 50, 30, 20, 12];
    // Use low engagement scores so strong-performer doesn't claim these first
    const rows = [
      makeRow({ contentSlug: 'seasonal', totalPageviews: 100, engagementScore: 0.1, monthlyPageviews: monthly }),
      makeRow({ contentSlug: 'filler1', totalPageviews: 100, engagementScore: 0.5 }),
      makeRow({ contentSlug: 'filler2', totalPageviews: 200, engagementScore: 0.9 }),
    ];
    const medians = computeMedians(rows);
    const insights = computeInsights(rows, medians);
    const seasonal = insights.find(i => i.type === 'seasonal');
    expect(seasonal).toBeDefined();
    expect(seasonal!.body).toBe('Views peak in July and drop in January.');
  });

  it('detects underused map variant', () => {
    // Use low engagement score so strong-performer doesn't claim the variant row first
    const rows = [
      makeRow({ contentSlug: 'variant-route', totalPageviews: 100, engagementScore: 0.1, variantViews: { 'map': 490, 'map:winter': 5, 'map:gravel': 5 } }),
      makeRow({ contentSlug: 'filler1', totalPageviews: 100, engagementScore: 0.5 }),
      makeRow({ contentSlug: 'filler2', totalPageviews: 200, engagementScore: 0.9 }),
    ];
    const medians = computeMedians(rows);
    const insights = computeInsights(rows, medians);
    const variant = insights.find(i => i.type === 'underused-variant');
    expect(variant).toBeDefined();
    expect(variant!.body).toContain('map:winter');
    expect(variant!.body).toContain('1%');
  });

  it('insight body text uses factual language only', () => {
    const rows = [
      makeRow({ contentSlug: 'trending-check', totalPageviews: 200, currentPeriodPageviews: 200, previousPeriodPageviews: 100 }),
      makeRow({
        contentSlug: 'seasonal-check', totalPageviews: 400,
        monthlyPageviews: [10, 15, 20, 25, 30, 40, 100, 80, 50, 30, 20, 12],
      }),
      makeRow({ contentSlug: 'declining-check', totalPageviews: 50, currentPeriodPageviews: 50, previousPeriodPageviews: 200 }),
      makeRow({
        contentSlug: 'variant-check', totalPageviews: 500,
        variantViews: { 'map': 490, 'map:winter': 5 },
      }),
    ];
    const medians = computeMedians(rows);
    const insights = computeInsights(rows, medians);

    const interpretiveWords = ['planning', 'intent', 'compelling', 'sticky', 'love', 'amazing', 'great'];
    for (const insight of insights) {
      for (const word of interpretiveWords) {
        expect(insight.body.toLowerCase()).not.toContain(word);
      }
    }
  });
});
