import type { PlausibleRow } from '../external/plausible-api.server';
import type { Database } from '../../db';
import { resolveUrl, detectLocale } from './url-resolver.server';
import { contentPageMetrics, siteDailyMetrics } from '../../db/schema';
import { sql } from 'drizzle-orm';

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
