/**
 * Seed analytics data from Plausible JSON fixtures for local development.
 * Develop-on-a-train: the stats dashboard works without a Plausible API key.
 *
 * Reads from e2e/fixtures/plausible/*.json and runs them through the same
 * pipeline as the real sync (processPageBreakdown, processDailyAggregate, etc).
 */
import type { Database } from '../../db';
import { siteDailyMetrics, contentTotals } from '../../db/schema';
import { eq, sql } from 'drizzle-orm';
import { processPageBreakdown, processPageDaily, processDailyAggregate, aggregateContentRows } from './parsers.server';
import { upsertContentRows, upsertTotalsRows, upsertDailyRows } from './upsert.server';
import { rebuildEngagement } from './engagement.server';

/**
 * Seed analytics tables from fixture files if they're empty.
 * Only runs in local development (RUNTIME=local), only seeds once.
 */
export async function seedFromFixtures(db: Database, city: string): Promise<boolean> {
  // Check if data already exists
  const existing = await db.select({ count: sql<number>`COUNT(*)` })
    .from(siteDailyMetrics)
    .where(eq(siteDailyMetrics.city, city));

  if ((existing[0]?.count ?? 0) > 0) return false; // already seeded

  // Load fixture files — these are committed to the repo
  const fs = await import('node:fs');
  const path = await import('node:path');

  const fixtureDir = path.join(process.cwd(), 'e2e', 'fixtures', 'plausible');

  const loadFixture = (name: string) => {
    const filePath = path.join(fixtureDir, name);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  };

  const dailyAggregate = loadFixture('daily-aggregate.json');
  const pageBreakdown = loadFixture('page-breakdown.json');
  const pageDaily = loadFixture('page-daily.json');

  if (!dailyAggregate || !pageBreakdown) {
    console.log('stats: fixture files not found, skipping seed');
    return false;
  }

  // Load redirects from virtual module (build-time baked from redirects.yml)
  let redirects: Record<string, string> = {};
  try {
    const mod = await import('virtual:bike-app/route-redirects');
    redirects = mod.default;
  } catch {
    // Virtual module not available (tests, scripts) — try filesystem
    try {
      const yaml = await import('js-yaml');
      const { cityDir } = await import('../config/config.server');
      const redirectsPath = path.join(cityDir, 'redirects.yml');
      if (fs.existsSync(redirectsPath)) {
        const data = yaml.load(fs.readFileSync(redirectsPath, 'utf-8')) as Record<string, Array<{ from: string; to: string }>> | null;
        if (data?.routes) {
          for (const r of data.routes) redirects[r.from] = r.to;
        }
      }
    } catch { /* no redirects available */ }
  }

  const locales = ['en', 'fr']; // eslint-disable-line bike-app/no-hardcoded-city-locale
  const defaultLocale = 'en'; // eslint-disable-line bike-app/no-hardcoded-city-locale
  const today = new Date().toISOString().split('T')[0];

  // 1. Site daily aggregates
  const dailyRows = processDailyAggregate(dailyAggregate.results, city);
  if (dailyRows.length > 0) {
    await upsertDailyRows(db, dailyRows);
  }

  // 2. Page breakdown → content_totals (for engagement scores)
  const { contentRows } = processPageBreakdown(
    pageBreakdown.results, city, {}, redirects, today, locales, defaultLocale,
  );
  if (contentRows.length > 0) {
    await db.delete(contentTotals).where(eq(contentTotals.city, city)).run();
    const totalsRows = aggregateContentRows(contentRows, today);
    await upsertTotalsRows(db, totalsRows);
  }

  // 3. Per-page daily data (for drill-down time series)
  if (pageDaily) {
    const { contentRows: dailyContentRows } = processPageDaily(
      pageDaily.results, city, {}, redirects, locales, defaultLocale,
    );
    if (dailyContentRows.length > 0) {
      await upsertContentRows(db, dailyContentRows);
    }
  }

  // 4. Rebuild engagement scores
  await rebuildEngagement(db, city);

  console.log(`stats: seeded from fixtures — ${dailyRows.length} daily rows, ${contentRows.length} content rows`);
  return true;
}
