import { describe, it, expect, vi } from 'vitest';
import { createTestDb } from '../test-db';
import { contentTotals, contentEngagement } from '../../src/db/schema';
import type { Database } from '../../src/db';
import { eq } from 'drizzle-orm';
import { syncSiteMetrics } from '../../src/lib/stats/sync.server';
import { upsertTotalsRows } from '../../src/lib/stats/upsert.server';
import { rebuildEngagement } from '../../src/lib/stats/engagement.server';

// syncSiteMetrics's dailyRows/pageRows queries are load-bearing for the
// delete-then-rebuild of content_totals/content_engagement below them —
// a rejection must short-circuit before that rewrite, not after.
vi.mock('../../src/lib/external/plausible-api.server', () => ({
  queryPlausible: vi.fn().mockRejectedValue(new Error('Plausible API error 401: invalid API key')),
}));

const CITY = 'test-city'; // eslint-disable-line bike-app/no-hardcoded-city-locale

describe('syncSiteMetrics degrades on Plausible failure', () => {
  it('reports syncFailed and leaves existing content_totals/content_engagement untouched', async () => {
    const testDb = createTestDb();
    try {
      // Seed D1 as if a prior successful sync already ran.
      await upsertTotalsRows(testDb.db as unknown as Database, [{
        city: CITY, contentType: 'route', contentSlug: 'existing-route', pageType: 'detail',
        pageviews: 500, visitorDays: 300, visitDurationS: 6000, bounceRate: 20,
        videoPlays: 5, gpxDownloads: 2, syncedAt: '2026-07-01T00:00:00.000Z',
      }]);
      await rebuildEngagement(testDb.db as unknown as Database, CITY);
      const engagementBefore = testDb.db.select().from(contentEngagement)
        .where(eq(contentEngagement.city, CITY)).all();
      expect(engagementBefore.length).toBe(1);

      const result = await syncSiteMetrics(testDb.db as unknown as Database, {
        apiKey: 'broken-key', siteId: 'site', city: CITY, locales: ['en'], defaultLocale: 'en',
      });

      expect(result).toEqual({ dailyRows: 0, contentPages: 0, syncFailed: true });

      // A failed sync must not advance bookkeeping — existing totals and
      // engagement scores (built from those totals) must survive untouched.
      const totalsAfter = testDb.db.select().from(contentTotals)
        .where(eq(contentTotals.city, CITY)).all();
      expect(totalsAfter.length).toBe(1);
      expect(totalsAfter[0].contentSlug).toBe('existing-route');
      expect(totalsAfter[0].pageviews).toBe(500);

      const engagementAfter = testDb.db.select().from(contentEngagement)
        .where(eq(contentEngagement.city, CITY)).all();
      expect(engagementAfter.length).toBe(1);
    } finally {
      testDb.cleanup();
    }
  });
});
