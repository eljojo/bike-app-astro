import type { PlausibleRow } from '../external/plausible-api.server';
import { queryPlausible } from '../external/plausible-api.server';
import type { Database } from '../../db';
import { resolveUrl, detectLocale } from './url-resolver.server';
import { rebuildEngagement } from './engagement.server';
import { contentPageMetrics, siteDailyMetrics } from '../../db/schema';
import { sql, eq, desc } from 'drizzle-orm';

/**
 * A content page metric row ready for DB upsert.
 * Mirrors the content_page_metrics schema columns.
 */
export interface ContentMetricRow {
  city: string;
  contentType: string;
  contentSlug: string;
  pageType: string;
  date: string;
  pageviews: number;
  visitorDays: number;
  visitDurationS: number;
  bounceRate: number;
  videoPlays: number;
}

/**
 * A site daily metric row ready for DB upsert.
 * Mirrors the site_daily_metrics schema columns.
 */
export interface DailyMetricRow {
  city: string;
  date: string;
  totalPageviews: number;
  uniqueVisitors: number;
  newAccounts: number;
  reactionsCount: number;
  activeUsers: number;
}

/**
 * Process Plausible page-breakdown results into content metric rows.
 *
 * Page-breakdown fixture metrics order: [pageviews, visitors, visit_duration, bounce_rate]
 * Dimensions: [pagePath]
 *
 * @param rows - Plausible API result rows
 * @param city - City identifier
 * @param slugAliases - Translated slug to canonical slug map
 * @param redirects - Old slug to current slug map
 * @param date - Date string to use for all rows (breakdown data is aggregate)
 * @param locales - Supported locale codes (e.g., ['en', 'fr'])
 * @param defaultLoc - Default locale code (e.g., 'en')
 */
export function processPlausibleData(
  rows: PlausibleRow[],
  city: string,
  slugAliases: Record<string, string>,
  redirects: Record<string, string>,
  date: string,
  locales: string[],
  defaultLoc: string,
): { contentRows: ContentMetricRow[]; skippedPaths: string[] } {
  const contentRows: ContentMetricRow[] = [];
  const skippedPaths: string[] = [];

  for (const row of rows) {
    const fullPath = row.dimensions[0];
    const [locale, pathWithoutLocale] = detectLocale(fullPath, locales, defaultLoc);
    const identity = resolveUrl(pathWithoutLocale, locale, slugAliases, redirects);

    if (!identity) {
      skippedPaths.push(fullPath);
      continue;
    }

    contentRows.push({
      city,
      contentType: identity.contentType,
      contentSlug: identity.contentSlug,
      pageType: identity.pageType,
      date,
      pageviews: row.metrics[0],
      visitorDays: row.metrics[1],
      visitDurationS: row.metrics[2],
      bounceRate: row.metrics[3],
      videoPlays: 0,
    });
  }

  return { contentRows, skippedPaths };
}

/**
 * Process Plausible daily aggregate results into site daily metric rows.
 *
 * Daily-aggregate fixture metrics order: [pageviews, visitors, bounce_rate]
 * Dimensions: [date]
 */
export function processDailyAggregate(
  rows: PlausibleRow[],
  city: string,
): DailyMetricRow[] {
  return rows.map((row) => ({
    city,
    date: row.dimensions[0],
    totalPageviews: row.metrics[0],
    uniqueVisitors: row.metrics[1],
    newAccounts: 0,
    reactionsCount: 0,
    activeUsers: 0,
  }));
}

/**
 * Upsert content page metric rows into the database.
 * On conflict (city, content_type, content_slug, page_type, date), updates all metric columns.
 */
export async function upsertContentRows(db: Database, rows: ContentMetricRow[]): Promise<void> {
  if (rows.length === 0) return;

  for (const row of rows) {
    await db.insert(contentPageMetrics)
      .values(row)
      .onConflictDoUpdate({
        target: [
          contentPageMetrics.city,
          contentPageMetrics.contentType,
          contentPageMetrics.contentSlug,
          contentPageMetrics.pageType,
          contentPageMetrics.date,
        ],
        set: {
          pageviews: sql`excluded.pageviews`,
          visitorDays: sql`excluded.visitor_days`,
          visitDurationS: sql`excluded.visit_duration_s`,
          bounceRate: sql`excluded.bounce_rate`,
          videoPlays: sql`excluded.video_plays`,
        },
      })
      .run();
  }
}

/**
 * Upsert site daily metric rows into the database.
 * On conflict (city, date), updates all metric columns.
 */
export async function upsertDailyRows(db: Database, rows: DailyMetricRow[]): Promise<void> {
  if (rows.length === 0) return;

  for (const row of rows) {
    await db.insert(siteDailyMetrics)
      .values(row)
      .onConflictDoUpdate({
        target: [
          siteDailyMetrics.city,
          siteDailyMetrics.date,
        ],
        set: {
          totalPageviews: sql`excluded.total_pageviews`,
          uniqueVisitors: sql`excluded.unique_visitors`,
          newAccounts: sql`excluded.new_accounts`,
          reactionsCount: sql`excluded.reactions_count`,
          activeUsers: sql`excluded.active_users`,
        },
      })
      .run();
  }
}

/**
 * Check whether analytics data needs syncing.
 * Returns true if no data exists or the most recent synced day is older than maxAgeMs.
 */
export async function needsSync(db: Database, city: string, maxAgeMs = 24 * 60 * 60 * 1000): Promise<boolean> {
  const lastRow = await db.select({ date: siteDailyMetrics.date })
    .from(siteDailyMetrics)
    .where(eq(siteDailyMetrics.city, city))
    .orderBy(desc(siteDailyMetrics.date))
    .limit(1);

  if (lastRow.length === 0) return true;

  const lastDate = new Date(lastRow[0].date + 'T00:00:00Z');
  return (Date.now() - lastDate.getTime()) > maxAgeMs;
}

interface SyncOptions {
  apiKey: string;
  siteId: string;
  city: string;
  locales: string[];
  defaultLocale: string;
  full?: boolean;
}

/**
 * Run the full Plausible → D1 sync pipeline.
 * Used by both the sync API endpoint and auto-sync on page visit.
 */
export async function runSync(db: Database, opts: SyncOptions): Promise<{ contentPages: number; skippedPaths: number; dailyRows: number }> {
  let fromDate: string;
  if (opts.full) {
    fromDate = '2020-01-01';
  } else {
    const lastRow = await db.select({ date: siteDailyMetrics.date })
      .from(siteDailyMetrics)
      .where(eq(siteDailyMetrics.city, opts.city))
      .orderBy(desc(siteDailyMetrics.date))
      .limit(1);
    fromDate = lastRow.length > 0 ? lastRow[0].date : '2020-01-01';
  }

  const today = new Date().toISOString().split('T')[0];

  // 1. Fetch page breakdown
  const pageRows = await queryPlausible(opts.apiKey, {
    siteId: opts.siteId,
    metrics: ['visitors', 'pageviews', 'visit_duration', 'bounce_rate'],
    dateRange: [fromDate, today],
    dimensions: ['event:page'],
    pagination: { limit: 10000 },
  });

  // 2. Process through URL resolver
  const { contentRows, skippedPaths } = processPlausibleData(
    pageRows, opts.city, {}, {}, today, opts.locales, opts.defaultLocale,
  );

  // 3. Upsert content metrics
  if (contentRows.length > 0) {
    await upsertContentRows(db, contentRows);
  }

  // 4. Fetch daily aggregates
  const dailyRows = await queryPlausible(opts.apiKey, {
    siteId: opts.siteId,
    metrics: ['visitors', 'pageviews', 'visit_duration', 'bounce_rate'],
    dateRange: [fromDate, today],
    dimensions: ['time:day'],
  });

  // 5. Process and upsert daily metrics
  const dailyMetrics = processDailyAggregate(dailyRows, opts.city);
  if (dailyMetrics.length > 0) {
    await upsertDailyRows(db, dailyMetrics);
  }

  // 6. Rebuild engagement scores
  await rebuildEngagement(db, opts.city);

  return { contentPages: contentRows.length, skippedPaths: skippedPaths.length, dailyRows: dailyMetrics.length };
}
