import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-db';
import { processPageBreakdown, processPageDaily, processDailyAggregate } from '../../src/lib/stats/parsers.server';
import { upsertContentRows, upsertDailyRows } from '../../src/lib/stats/upsert.server';
import { contentDailyMetrics, siteDailyMetrics } from '../../src/db/schema';
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
      const rows = testDb.db.select().from(contentDailyMetrics)
        .where(eq(contentDailyMetrics.city, FIXTURE_CITY))
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
      const rows = testDb.db.select().from(contentDailyMetrics)
        .where(eq(contentDailyMetrics.city, FIXTURE_CITY))
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
      const dbRows = testDb.db.select().from(contentDailyMetrics)
        .where(eq(contentDailyMetrics.contentSlug, 'the-big-loop'))
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

  it('resolves numbered slugs from full-history fixture via redirects', () => {
    // Uses the full-history page breakdown fixture (recorded with make record-plausible)
    // This fixture captures old numbered URLs like /routes/16-the-big-loop-around-ottawa
    const fullFixturePath = 'e2e/fixtures/plausible/page-breakdown-full.json';
    if (!fs.existsSync(fullFixturePath)) return; // skip if not recorded yet

    const fixture = JSON.parse(fs.readFileSync(fullFixturePath, 'utf-8'));
    const yaml = require('js-yaml');
    const redirectsPath = '../bike-routes/ottawa/redirects.yml';
    if (!fs.existsSync(redirectsPath)) return;

    const data = yaml.load(fs.readFileSync(redirectsPath, 'utf-8')) as Record<string, Array<{ from: string; to: string }>>;
    const redirects: Record<string, string> = {};
    for (const r of data.routes || []) redirects[r.from] = r.to;

    const result = processPageBreakdown(fixture.results, 'ottawa', {}, redirects, '2025-03-23', ['en', 'fr'], 'en'); // eslint-disable-line bike-app/no-hardcoded-city-locale

    // No numbered slugs should survive — all should be resolved via redirects
    const numberedSlugs = result.contentRows.filter(r => /^\d+-/.test(r.contentSlug));
    const uniqueUnresolved = [...new Set(numberedSlugs.map(r => r.contentSlug))];
    expect(uniqueUnresolved).toEqual([]);

    // Verify specific mappings from the bug report
    const allSlugs = new Set(result.contentRows.map(r => r.contentSlug));
    expect(allSlugs.has('16-the-big-loop-around-ottawa')).toBe(false);
    expect(allSlugs.has('the-big-loop-around-ottawa')).toBe(true);
    expect(allSlugs.has('1-aylmer')).toBe(false);
    expect(allSlugs.has('aylmer')).toBe(true);
    expect(allSlugs.has('4-loop-around-the-canal')).toBe(false);
    expect(allSlugs.has('easy-loop-around-the-canal')).toBe(true);
  });

  it('resolves all numbered slugs from real redirects.yml', () => {
    // Load the actual redirects.yml from the Ottawa data repo
    const fs = require('node:fs');
    const yaml = require('js-yaml');
    const redirectsPath = '../bike-routes/ottawa/redirects.yml';
    if (!fs.existsSync(redirectsPath)) return; // skip if data repo not available

    const data = yaml.load(fs.readFileSync(redirectsPath, 'utf-8')) as Record<string, Array<{ from: string; to: string }>>;
    const redirects: Record<string, string> = {};
    for (const r of data.routes || []) redirects[r.from] = r.to;

    // Every numbered slug from the "Most viewed" list that was failing
    const problematicSlugs = [
      '16-the-big-loop-around-ottawa',
      '27-experimental-farm-and-carlington-woods',
      '4-easy-loop-around-the-canal',
      '14-east-end-petrie-island',
      '22-ottawa-to-plaisance',
      '1-aylmer',
      '26-chill-loop-to-lake-leamy',
      '15-greenbelt',
    ];

    // Simulate Plausible rows with these slugs
    const rows = problematicSlugs.map(slug => ({
      dimensions: [`/routes/${slug}`],
      metrics: [100, 200, 120, 40],
    }));

    const result = processPageBreakdown(rows, 'test', {}, redirects, '2025-03-22', ['en'], 'en');

    // None of the numbered slugs should survive — all should be resolved
    for (const row of result.contentRows) {
      expect(row.contentSlug).not.toMatch(/^\d+-/);
    }

    // Verify specific mappings
    const slugs = new Set(result.contentRows.map(r => r.contentSlug));
    expect(slugs.has('the-big-loop-around-ottawa')).toBe(true);
    expect(slugs.has('easy-loop-around-the-canal')).toBe(true);
    expect(slugs.has('aylmer')).toBe(true);
    expect(slugs.has('lake-leamy')).toBe(true); // 26-chill-loop-to-lake-leamy → lake-leamy
    expect(slugs.has('greenbelt')).toBe(true);
  });

  it('aggregates duplicate paths into single totals row', () => {
    // Bug: /routes/wakefield (4942 pv) and /routes/wakefield/ (42 pv) both
    // resolve to (route, wakefield, detail). Without aggregation, the second
    // overwrites the first, making detail=42 while map=970 → 2309% conversion.
    const rows = [
      { dimensions: ['/routes/wakefield'], metrics: [4942, 3000, 120, 40] },
      { dimensions: ['/routes/wakefield/'], metrics: [42, 30, 100, 35] },
      { dimensions: ['/routes/wakefield/map'], metrics: [970, 800, 60, 30] },
      { dimensions: ['/routes/wakefield/map/'], metrics: [7, 5, 45, 25] },
    ];

    const result = processPageBreakdown(rows, 'test', {}, {}, '2025-03-23', ['en'], 'en');

    // Two rows with slug=wakefield, pageType=detail should exist
    const detailRows = result.contentRows.filter(r => r.contentSlug === 'wakefield' && r.pageType === 'detail');
    const mapRows = result.contentRows.filter(r => r.contentSlug === 'wakefield' && r.pageType === 'map');

    // processPageBreakdown returns raw rows (not aggregated) — the aggregation
    // happens in syncSiteMetrics before writing to content_totals.
    // But we can verify both paths resolved to the same slug.
    expect(detailRows.length).toBe(2);
    expect(mapRows.length).toBe(2);
    expect(detailRows[0].contentSlug).toBe('wakefield');
    expect(detailRows[1].contentSlug).toBe('wakefield');

    // Total detail pageviews should be 4942 + 42 = 4984
    const totalDetail = detailRows.reduce((s, r) => s + r.pageviews, 0);
    expect(totalDetail).toBe(4984);

    // Total map pageviews should be 970 + 7 = 977
    const totalMap = mapRows.reduce((s, r) => s + r.pageviews, 0);
    expect(totalMap).toBe(977);

    // Ratio should be ~19.6%, not 100%
    expect(totalMap / totalDetail).toBeLessThan(0.3);
  });

  it('built redirects.json contains entries when data repo has redirects.yml', () => {
    // Verifies the prerendered redirects.json endpoint produces non-empty output.
    // If this file is empty after a build, redirects won't be applied during sync.
    const builtPath = 'dist/client/admin/data/redirects.json';
    if (!fs.existsSync(builtPath)) return; // skip if not built

    const built = JSON.parse(fs.readFileSync(builtPath, 'utf-8'));
    const count = Object.keys(built).length;

    // The demo city (E2E) has no redirects.yml, so 0 is expected for CITY=demo.
    // For ottawa, we expect 30+ entries.
    const city = process.env.CITY || 'ottawa'; // eslint-disable-line bike-app/no-hardcoded-city-locale
    if (city === 'demo') {
      expect(count).toBe(0);
    } else {
      expect(count).toBeGreaterThan(0);
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
