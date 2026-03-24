/**
 * Tests that assert computed stats values match known fixture data.
 * These catch regressions like dividing by pageviews instead of visitors,
 * or treating total seconds as averages.
 */
import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-db';
import type { Database } from '../../src/db';
import {
  processPageBreakdown, processPageDaily, processDailyAggregate,
  upsertTotalsRows, aggregateContentRows,
} from '../../src/lib/stats/sync.server';
import { rebuildEngagement } from '../../src/lib/stats/engagement.server';
import { contentEngagement } from '../../src/db/schema';
import { eq, and } from 'drizzle-orm';
import fs from 'node:fs';

const pageBreakdown = JSON.parse(fs.readFileSync('e2e/fixtures/plausible/page-breakdown.json', 'utf-8'));
const pageDaily = JSON.parse(fs.readFileSync('e2e/fixtures/plausible/page-daily.json', 'utf-8'));
const dailyAggregate = JSON.parse(fs.readFileSync('e2e/fixtures/plausible/daily-aggregate.json', 'utf-8'));

const CITY = 'ottawa'; // eslint-disable-line bike-app/no-hardcoded-city-locale

describe('computed values match fixture data', () => {

  it('daily aggregate stores total duration, not average', () => {
    // Site-wide Mar 3: pv=50, vis=12, dur=395
    const mar3 = dailyAggregate.results.find(
      (r: { dimensions: string[] }) => r.dimensions[0] === '2026-03-03',
    );
    expect(mar3).toBeDefined();

    const result = processDailyAggregate([mar3], CITY);
    expect(result[0].totalPageviews).toBe(50);
    expect(result[0].uniqueVisitors).toBe(12);
    expect(result[0].totalDurationS).toBe(395);

    // Average per visit = 395 / 12 = ~33s (NOT 395 / 50 = ~8s)
    const avgPerVisit = result[0].totalDurationS / result[0].uniqueVisitors;
    expect(avgPerVisit).toBeCloseTo(32.9, 0);

    // Per-pageview would be wrong — verify it's different
    const wrongPerPageview = result[0].totalDurationS / result[0].totalPageviews;
    expect(wrongPerPageview).toBeCloseTo(7.9, 0);
    expect(avgPerVisit).toBeGreaterThan(wrongPerPageview * 2);
  });

  it('per-page daily stores total duration correctly', () => {
    // Greenbelt Mar 3: /routes/greenbelt/ — pv=3, vis=3, dur=1266
    const row = pageDaily.results.find(
      (r: { dimensions: string[] }) =>
        r.dimensions[0] === '2026-03-03' && r.dimensions[1] === '/routes/greenbelt/',
    );
    expect(row).toBeDefined();

    const result = processPageDaily([row], CITY, {}, {}, ['en'], 'en');
    expect(result.contentRows.length).toBe(1);
    const cr = result.contentRows[0];
    expect(cr.contentSlug).toBe('greenbelt');
    expect(cr.pageviews).toBe(3);
    expect(cr.visitorDays).toBe(3);
    expect(cr.visitDurationS).toBe(1266);

    // Average per visitor = 1266 / 3 = 422s = ~7min
    const avgPerVisitor = cr.visitDurationS / cr.visitorDays;
    expect(avgPerVisitor).toBe(422);

    // NOT 1266 / 3 pageviews = 422 (same here since pv == vis, but the principle matters)
    // The key assertion: visitDurationS is the RAW total, not divided by anything
    expect(cr.visitDurationS).toBe(1266);
  });

  it('engagement wallTimeHours = total seconds / 3600', async () => {
    const testDb = createTestDb();
    try {
      const db = testDb.db as unknown as Database;

      // Process page breakdown for greenbelt — multiple URLs resolve to same slug
      const greenbeltRows = pageBreakdown.results.filter(
        (r: { dimensions: string[] }) =>
          r.dimensions[0].includes('greenbelt') && r.dimensions[0].startsWith('/routes/'),
      );

      const result = processPageBreakdown(greenbeltRows, CITY, {}, {}, '2025-03-22', ['en', 'fr'], 'en');
      const totals = aggregateContentRows(result.contentRows, '2025-03-22');
      await upsertTotalsRows(db, totals);
      await rebuildEngagement(db, CITY);

      const eng = testDb.db.select().from(contentEngagement)
        .where(and(
          eq(contentEngagement.city, CITY),
          eq(contentEngagement.contentType, 'route'),
          eq(contentEngagement.contentSlug, 'greenbelt'),
        ))
        .all();

      expect(eng.length).toBe(1);

      // Total duration from fixture: 382 seconds across all greenbelt route pages
      // wallTimeHours = 382 / 3600 = 0.1061
      expect(eng[0].wallTimeHours).toBeCloseTo(382 / 3600, 3);

      // avgVisitDuration comes from DETAIL page type only
      // It should be totalDurationS / visitorDays for detail rows
      // The exact value depends on which rows resolve with {} redirects
      // Key assertion: avgVisitDuration > 0 and is per-visitor, not per-pageview
      expect(eng[0].avgVisitDuration).toBeGreaterThan(0);
      // Per-visitor should be larger than per-pageview (visits have multiple pageviews)
      // wallTimeHours * 3600 = total seconds, totalPageviews = total pageviews
      // avgVisitDuration should be >= wallTimeHours * 3600 / totalPageviews
      const perPageview = eng[0].wallTimeHours * 3600 / eng[0].totalPageviews;
      expect(eng[0].avgVisitDuration).toBeGreaterThanOrEqual(perPageview);
    } finally {
      testDb.cleanup();
    }
  });

  it('aggregation sums duration (total seconds), not averages', () => {
    // Two rows for the same slug — /routes/wakefield (dur=5000) and /routes/wakefield/ (dur=200)
    const rows = [
      { dimensions: ['/routes/wakefield'], metrics: [4942, 3000, 5000, 40] },
      { dimensions: ['/routes/wakefield/'], metrics: [42, 30, 200, 35] },
    ];

    const result = processPageBreakdown(rows, 'test', {}, {}, '2025-03-22', ['en'], 'en');
    const totals = aggregateContentRows(result.contentRows, '2025-03-22');

    const wk = totals.find(t => t.contentSlug === 'wakefield' && t.pageType === 'detail');
    expect(wk).toBeDefined();

    // Duration should be SUMMED (5000 + 200 = 5200), not weighted-averaged
    expect(wk!.visitDurationS).toBe(5200);
    expect(wk!.pageviews).toBe(4984);
    expect(wk!.visitorDays).toBe(3030);
  });
});
