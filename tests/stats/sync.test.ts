import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-db';
import { processPlausibleData, processDailyAggregate, upsertContentRows, upsertDailyRows } from '../../src/lib/stats/sync.server';
import { contentPageMetrics, siteDailyMetrics } from '../../src/db/schema';
import type { Database } from '../../src/db';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';

const pageBreakdown = JSON.parse(fs.readFileSync('e2e/fixtures/plausible/page-breakdown.json', 'utf-8'));
const dailyAggregate = JSON.parse(fs.readFileSync('e2e/fixtures/plausible/daily-aggregate.json', 'utf-8'));

// Fixture city — matches the Plausible fixture data origin
const FIXTURE_CITY = 'ottawa'; // eslint-disable-line bike-app/no-hardcoded-city-locale

describe('sync pipeline', () => {

  it('processes page breakdown fixture and writes to DB', async () => {
    const testDb = createTestDb();
    try {
      const result = processPlausibleData(pageBreakdown.results, FIXTURE_CITY, {}, {}, 'aggregate', ['en', 'fr'], 'en');

      expect(result.contentRows.length).toBeGreaterThan(0);
      expect(result.skippedPaths.length).toBeGreaterThan(0);

      await upsertContentRows(testDb.db as unknown as Database, result.contentRows);
      const rows = testDb.db.select().from(contentPageMetrics)
        .where(eq(contentPageMetrics.city, FIXTURE_CITY))
        .all();
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.length).toBeLessThanOrEqual(result.contentRows.length);
      expect(rows[0]).toHaveProperty('contentType');
      expect(rows[0]).toHaveProperty('contentSlug');
      expect(rows[0].pageviews).toBeGreaterThan(0);
    } finally {
      testDb.cleanup();
    }
  });

  it('processes daily aggregate fixture and writes to DB', async () => {
    const testDb = createTestDb();
    try {
      const result = processDailyAggregate(dailyAggregate.results, FIXTURE_CITY);

      expect(result.length).toBeGreaterThan(50);
      expect(result[0]).toHaveProperty('date');
      expect(result[0]).toHaveProperty('totalPageviews');

      await upsertDailyRows(testDb.db as unknown as Database, result);
      const rows = testDb.db.select().from(siteDailyMetrics)
        .where(eq(siteDailyMetrics.city, FIXTURE_CITY))
        .all();
      expect(rows.length).toBe(result.length);
    } finally {
      testDb.cleanup();
    }
  });
});
