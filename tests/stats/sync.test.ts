import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-db';
import { processPageBreakdown, processPageDaily, processDailyAggregate, upsertContentRows, upsertDailyRows } from '../../src/lib/stats/sync.server';
import { contentPageMetrics, siteDailyMetrics } from '../../src/db/schema';
import type { Database } from '../../src/db';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';

const pageBreakdown = JSON.parse(fs.readFileSync('e2e/fixtures/plausible/page-breakdown.json', 'utf-8'));
const pageDaily = JSON.parse(fs.readFileSync('e2e/fixtures/plausible/page-daily.json', 'utf-8'));
const dailyAggregate = JSON.parse(fs.readFileSync('e2e/fixtures/plausible/daily-aggregate.json', 'utf-8'));

// Fixture city — matches the Plausible fixture data origin
const FIXTURE_CITY = 'ottawa'; // eslint-disable-line bike-app/no-hardcoded-city-locale

describe('sync pipeline', () => {

  it('processes page breakdown fixture (aggregate) and writes to DB', async () => {
    const testDb = createTestDb();
    try {
      const result = processPageBreakdown(pageBreakdown.results, FIXTURE_CITY, {}, {}, '2025-03-22', ['en', 'fr'], 'en');

      expect(result.contentRows.length).toBeGreaterThan(0);
      expect(result.skippedPaths.length).toBeGreaterThan(0);
      // All rows have the same date (aggregate mode)
      expect(result.contentRows[0].date).toBe('2025-03-22');

      await upsertContentRows(testDb.db as unknown as Database, result.contentRows);
      const rows = testDb.db.select().from(contentPageMetrics)
        .where(eq(contentPageMetrics.city, FIXTURE_CITY))
        .all();
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]).toHaveProperty('contentType');
      expect(rows[0]).toHaveProperty('contentSlug');
      expect(rows[0].pageviews).toBeGreaterThan(0);
    } finally {
      testDb.cleanup();
    }
  });

  it('processes page-daily fixture (per-page daily) and writes to DB', async () => {
    const testDb = createTestDb();
    try {
      const result = processPageDaily(pageDaily.results, FIXTURE_CITY, {}, {}, ['en', 'fr'], 'en');

      expect(result.contentRows.length).toBeGreaterThan(0);
      // Rows have real dates from dimensions[0]
      expect(result.contentRows[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // Multiple distinct dates
      const dates = new Set(result.contentRows.map(r => r.date));
      expect(dates.size).toBeGreaterThan(1);

      await upsertContentRows(testDb.db as unknown as Database, result.contentRows);
      const rows = testDb.db.select().from(contentPageMetrics)
        .where(eq(contentPageMetrics.city, FIXTURE_CITY))
        .all();
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      testDb.cleanup();
    }
  });

  it('resolves numbered slugs to canonical slugs via redirects', () => {
    // Bug: Plausible logs visits to old numbered URLs like /routes/16-the-big-loop-around-ottawa
    // The URL resolver should map these to canonical slugs via redirects.yml
    const redirects: Record<string, string> = {
      '16-the-big-loop-around-ottawa': 'the-big-loop-around-ottawa',
      '4-easy-loop-around-the-canal': 'easy-loop-around-the-canal',
      '27-experimental-farm-and-carlington-woods': 'experimental-farm-and-carlington-woods',
    };

    const rows = [
      { dimensions: ['/routes/16-the-big-loop-around-ottawa'], metrics: [100, 200, 120, 40] },
      { dimensions: ['/routes/the-big-loop-around-ottawa'], metrics: [50, 100, 90, 35] },
      { dimensions: ['/routes/4-easy-loop-around-the-canal'], metrics: [80, 160, 100, 45] },
    ];

    const result = processPageBreakdown(rows, 'test', {}, redirects, '2025-03-22', ['en'], 'en');

    // The numbered slug should resolve to the canonical slug
    const slugs = result.contentRows.map(r => r.contentSlug);
    expect(slugs).not.toContain('16-the-big-loop-around-ottawa');
    expect(slugs).not.toContain('4-easy-loop-around-the-canal');
    expect(slugs).toContain('the-big-loop-around-ottawa');
    expect(slugs).toContain('easy-loop-around-the-canal');
  });

  it('merges redirected and canonical slug pageviews after upsert', async () => {
    // When both /routes/16-the-big-loop and /routes/the-big-loop are in Plausible,
    // they should both resolve to the same canonical slug and upsert merges them
    const testDb = createTestDb();
    try {
      const redirects: Record<string, string> = {
        '16-the-big-loop': 'the-big-loop',
      };

      const rows = [
        { dimensions: ['/routes/16-the-big-loop'], metrics: [100, 200, 120, 40] },
        { dimensions: ['/routes/the-big-loop'], metrics: [50, 100, 90, 35] },
      ];

      const result = processPageBreakdown(rows, 'test', {}, redirects, '2025-03-22', ['en'], 'en');

      // Both resolve to the same slug
      expect(result.contentRows.every(r => r.contentSlug === 'the-big-loop')).toBe(true);

      // After upsert, there should be exactly one row (second write overwrites first)
      await upsertContentRows(testDb.db as unknown as Database, result.contentRows);
      const dbRows = testDb.db.select().from(contentPageMetrics)
        .where(eq(contentPageMetrics.contentSlug, 'the-big-loop'))
        .all();
      expect(dbRows.length).toBe(1);
    } finally {
      testDb.cleanup();
    }
  });

  it('without redirects, numbered slugs are stored as-is (regression baseline)', () => {
    // This test documents the bug: when redirects are empty, numbered slugs
    // pass through unchanged. The sync pipeline must load redirects.yml.
    const rows = [
      { dimensions: ['/routes/16-the-big-loop-around-ottawa'], metrics: [100, 200, 120, 40] },
    ];

    const withoutRedirects = processPageBreakdown(rows, 'test', {}, {}, '2025-03-22', ['en'], 'en');
    // BUG: slug stored with the number prefix
    expect(withoutRedirects.contentRows[0].contentSlug).toBe('16-the-big-loop-around-ottawa');

    const withRedirects = processPageBreakdown(rows, 'test', {}, { '16-the-big-loop-around-ottawa': 'the-big-loop-around-ottawa' }, '2025-03-22', ['en'], 'en');
    // FIX: slug resolved to canonical
    expect(withRedirects.contentRows[0].contentSlug).toBe('the-big-loop-around-ottawa');
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
