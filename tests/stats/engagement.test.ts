import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-db';
import type { Database } from '../../src/db';
import { contentPageMetrics, contentEngagement } from '../../src/db/schema';
import { rebuildEngagement } from '../../src/lib/stats/engagement.server';

// Fixture city
const CITY = 'test'; // eslint-disable-line bike-app/no-hardcoded-city-locale

describe('rebuildEngagement', () => {
  it('caps map conversion rate at 100%', async () => {
    const testDb = createTestDb();
    try {
      const db = testDb.db as unknown as Database;

      // Insert aggregate detail row (single date, high pageviews)
      await db.insert(contentPageMetrics).values({
        city: CITY, contentType: 'route', contentSlug: 'test-route',
        pageType: 'detail', date: '2025-03-22',
        pageviews: 100, visitorDays: 80, visitDurationS: 120, bounceRate: 40, videoPlays: 0,
      }).run();

      // Insert many daily map rows that sum to more than detail views
      for (let i = 1; i <= 30; i++) {
        const date = `2025-03-${String(i).padStart(2, '0')}`;
        await db.insert(contentPageMetrics).values({
          city: CITY, contentType: 'route', contentSlug: 'test-route',
          pageType: 'map', date,
          pageviews: 10, visitorDays: 8, visitDurationS: 60, bounceRate: 30, videoPlays: 0,
        }).run();
      }

      // Map total = 300, detail total = 100 → raw ratio = 3.0
      await rebuildEngagement(db, CITY);

      const rows = testDb.db.select().from(contentEngagement).all();
      expect(rows.length).toBe(1);
      // Must be capped at 1.0 (100%), not 3.0 (300%)
      expect(rows[0].mapConversionRate).toBeLessThanOrEqual(1.0);
    } finally {
      testDb.cleanup();
    }
  });

  it('clears stale engagement rows on rebuild', async () => {
    const testDb = createTestDb();
    try {
      const db = testDb.db as unknown as Database;

      // Insert a stale engagement row for a slug that no longer has metrics
      await db.insert(contentEngagement).values({
        city: CITY, contentType: 'route', contentSlug: 'stale-route',
        totalPageviews: 999, totalVisitorDays: 500, avgVisitDuration: 120,
        avgBounceRate: 40, stars: 10, videoPlayRate: 0, mapConversionRate: 0.5,
        wallTimeHours: 50, engagementScore: 0.9, lastSyncedAt: '2025-01-01',
      }).run();

      // No content_page_metrics for this slug — rebuild should clear it
      await rebuildEngagement(db, CITY);

      const rows = testDb.db.select().from(contentEngagement).all();
      expect(rows.length).toBe(0);
    } finally {
      testDb.cleanup();
    }
  });
});
