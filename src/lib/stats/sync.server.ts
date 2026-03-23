import type { PlausibleRow } from '../external/plausible-api.server';
import { queryPlausible } from '../external/plausible-api.server';
import type { Database } from '../../db';
import { resolveUrl, detectLocale } from './url-resolver.server';
import { rebuildEngagement } from './engagement.server';
import { invalidateStatsCache } from './cache.server';
import { contentPageMetrics, siteDailyMetrics } from '../../db/schema';
import { sql, eq, and, desc } from 'drizzle-orm';

/**
 * A content page metric row ready for DB upsert.
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
 */
export interface DailyMetricRow {
  city: string;
  date: string;
  totalPageviews: number;
  uniqueVisitors: number;
  avgVisitDuration: number;
  newAccounts: number;
  reactionsCount: number;
  activeUsers: number;
}

/**
 * Process Plausible page-breakdown results (aggregate, no date dimension).
 * Dimensions: [pagePath]. Used for engagement score computation.
 */
export function processPageBreakdown(
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
      // Metrics order: ['pageviews', 'visitors', 'visit_duration', 'bounce_rate']
      pageviews: row.metrics[0],
      visitorDays: row.metrics[1],
      visitDurationS: row.metrics[2],
      bounceRate: row.metrics[3],
      videoPlays: 0,
    });
  }

  return { contentRows, skippedPaths };
}

// Keep old name as alias for test compatibility
export const processPlausibleData = processPageBreakdown;

/**
 * Process Plausible daily per-page results.
 * Dimensions: [date, pagePath]. Used for drill-down time series.
 */
export function processPageDaily(
  rows: PlausibleRow[],
  city: string,
  slugAliases: Record<string, string>,
  redirects: Record<string, string>,
  locales: string[],
  defaultLoc: string,
): { contentRows: ContentMetricRow[]; skippedPaths: string[] } {
  const contentRows: ContentMetricRow[] = [];
  const skippedPaths: string[] = [];

  for (const row of rows) {
    const date = row.dimensions[0];
    const fullPath = row.dimensions[1];
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
 * Metrics order: ['pageviews', 'visitors', 'visit_duration', 'bounce_rate']
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
    avgVisitDuration: row.metrics[2] ?? 0,
    newAccounts: 0,
    reactionsCount: 0,
    activeUsers: 0,
  }));
}

// ── Batch upsert helpers ────────────────────────────────────────────
// D1 has ~30-50ms latency per query. Row-by-row inserts of 300 rows
// would take 9-15 seconds. Batching into chunks of 50 rows brings
// that down to ~6 queries = ~200ms.

const BATCH_SIZE = 50;

/**
 * Upsert content page metric rows in batches.
 */
export async function upsertContentRows(db: Database, rows: ContentMetricRow[]): Promise<void> {
  if (rows.length === 0) return;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values = batch.map(r =>
      `('${r.city}','${r.contentType}','${esc(r.contentSlug)}','${r.pageType}','${r.date}',${r.pageviews},${r.visitorDays},${r.visitDurationS},${r.bounceRate},${r.videoPlays})`
    ).join(',');

    await db.run(sql.raw(`INSERT INTO content_page_metrics (city, content_type, content_slug, page_type, date, pageviews, visitor_days, visit_duration_s, bounce_rate, video_plays)
      VALUES ${values}
      ON CONFLICT (city, content_type, content_slug, page_type, date)
      DO UPDATE SET pageviews=excluded.pageviews, visitor_days=excluded.visitor_days, visit_duration_s=excluded.visit_duration_s, bounce_rate=excluded.bounce_rate, video_plays=excluded.video_plays`));
  }
}

/**
 * Upsert site daily metric rows in batches.
 */
export async function upsertDailyRows(db: Database, rows: DailyMetricRow[]): Promise<void> {
  if (rows.length === 0) return;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values = batch.map(r =>
      `('${r.city}','${r.date}',${r.totalPageviews},${r.uniqueVisitors},${r.avgVisitDuration},${r.newAccounts},${r.reactionsCount},${r.activeUsers})`
    ).join(',');

    await db.run(sql.raw(`INSERT INTO site_daily_metrics (city, date, total_pageviews, unique_visitors, avg_visit_duration, new_accounts, reactions_count, active_users)
      VALUES ${values}
      ON CONFLICT (city, date)
      DO UPDATE SET total_pageviews=excluded.total_pageviews, unique_visitors=excluded.unique_visitors, avg_visit_duration=excluded.avg_visit_duration, new_accounts=excluded.new_accounts, reactions_count=excluded.reactions_count, active_users=excluded.active_users`));
  }
}

/** Escape single quotes in SQL values. */
function esc(s: string): string {
  return s.replace(/'/g, "''");
}

/**
 * Check whether site-level analytics data needs syncing.
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
  redirects?: Record<string, string>;
  full?: boolean;
}

// ── Site-level sync (overview) ──────────────────────────────────────
// Two Plausible queries fired IN PARALLEL, then batch upserts.

export async function syncSiteMetrics(db: Database, opts: SyncOptions): Promise<{ dailyRows: number; contentPages: number }> {
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

  // Fire BOTH Plausible queries in parallel
  const [dailyRows, pageRows] = await Promise.all([
    queryPlausible(opts.apiKey, {
      siteId: opts.siteId,
      metrics: ['pageviews', 'visitors', 'visit_duration', 'bounce_rate'],
      dateRange: [fromDate, today],
      dimensions: ['time:day'],
    }),
    queryPlausible(opts.apiKey, {
      siteId: opts.siteId,
      metrics: ['pageviews', 'visitors', 'visit_duration', 'bounce_rate'],
      dateRange: [fromDate, today],
      dimensions: ['event:page'],
      pagination: { limit: 10000 },
    }),
  ]);

  const dailyMetrics = processDailyAggregate(dailyRows, opts.city);

  const redirectCount = Object.keys(opts.redirects ?? {}).length;
  const { contentRows, skippedPaths } = processPageBreakdown(
    pageRows, opts.city, {}, opts.redirects ?? {}, today, opts.locales, opts.defaultLocale,
  );

  const numberedSlugs = contentRows.filter(r => /^\d+-/.test(r.contentSlug));
  console.log(`stats sync: ${pageRows.length} Plausible rows → ${contentRows.length} content rows, ${skippedPaths.length} skipped, ${redirectCount} redirects loaded, ${numberedSlugs.length} unresolved numbered slugs`);
  if (numberedSlugs.length > 0) {
    console.log('stats sync: unresolved numbered slugs:', numberedSlugs.slice(0, 5).map(r => r.contentSlug));
  }

  // Batch upserts in parallel
  await Promise.all([
    dailyMetrics.length > 0 ? upsertDailyRows(db, dailyMetrics) : Promise.resolve(),
    contentRows.length > 0 ? upsertContentRows(db, contentRows) : Promise.resolve(),
  ]);

  // Rebuild engagement scores from aggregate data
  await rebuildEngagement(db, opts.city);

  // Invalidate dashboard cache
  await invalidateStatsCache(db, opts.city);

  return { dailyRows: dailyMetrics.length, contentPages: contentRows.length };
}

// ── Per-page sync (drill-down) ──────────────────────────────────────

/**
 * Check whether per-page daily data needs syncing.
 */
export async function needsPageSync(
  db: Database,
  city: string,
  contentType: string,
  contentSlug: string,
  maxAgeMs = 24 * 60 * 60 * 1000,
): Promise<boolean> {
  const lastRow = await db.select({ date: contentPageMetrics.date })
    .from(contentPageMetrics)
    .where(and(
      eq(contentPageMetrics.city, city),
      eq(contentPageMetrics.contentType, contentType),
      eq(contentPageMetrics.contentSlug, contentSlug),
    ))
    .orderBy(desc(contentPageMetrics.date))
    .limit(1);

  if (lastRow.length === 0) return true;

  const dates = await db.select({ date: contentPageMetrics.date })
    .from(contentPageMetrics)
    .where(and(
      eq(contentPageMetrics.city, city),
      eq(contentPageMetrics.contentType, contentType),
      eq(contentPageMetrics.contentSlug, contentSlug),
    ))
    .groupBy(contentPageMetrics.date);

  if (dates.length <= 1) return true;

  const lastDate = new Date(lastRow[0].date + 'T00:00:00Z');
  return (Date.now() - lastDate.getTime()) > maxAgeMs;
}

function buildPagePaths(contentType: string, contentSlug: string): string[] {
  switch (contentType) {
    case 'route': return [`/routes/${contentSlug}`];
    case 'event': return [`/events/${contentSlug}`];
    case 'organizer': return [`/communities/${contentSlug}`];
    default: return [];
  }
}

/**
 * Sync daily per-page data from Plausible for a single content item.
 */
export async function syncPageMetrics(
  db: Database,
  opts: SyncOptions & { contentType: string; contentSlug: string },
): Promise<number> {
  const paths = buildPagePaths(opts.contentType, opts.contentSlug);
  if (paths.length === 0) return 0;

  const today = new Date().toISOString().split('T')[0];

  const rows = await queryPlausible(opts.apiKey, {
    siteId: opts.siteId,
    metrics: ['pageviews', 'visitors', 'visit_duration', 'bounce_rate'],
    dateRange: ['2020-01-01', today],
    dimensions: ['time:day', 'event:page'],
    filters: [['contains', 'event:page', paths]],
    pagination: { limit: 10000 },
  });

  const { contentRows } = processPageDaily(
    rows, opts.city, {}, opts.redirects ?? {}, opts.locales, opts.defaultLocale,
  );

  if (contentRows.length > 0) {
    await upsertContentRows(db, contentRows);
  }

  return contentRows.length;
}

// ── Incremental sync helpers ────────────────────────────────────────
// Nix-like: check what's already in D1, fetch only what's missing.

function buildDateSet(from: string, to: string): Set<string> {
  const dates = new Set<string>();
  const d = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (d <= end) {
    dates.add(d.toISOString().split('T')[0]);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

function findContiguousRanges(dates: string[]): Array<[string, string]> {
  if (dates.length === 0) return [];
  const sorted = [...dates].sort();
  const ranges: Array<[string, string]> = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const expected = new Date(prev + 'T00:00:00Z');
    expected.setUTCDate(expected.getUTCDate() + 1);
    if (sorted[i] !== expected.toISOString().split('T')[0]) {
      ranges.push([start, prev]);
      start = sorted[i];
    }
    prev = sorted[i];
  }
  ranges.push([start, prev]);
  return ranges;
}

/**
 * Ensure site_daily_metrics has data for the given date range.
 * Finds missing dates, fetches only those from Plausible.
 */
export async function ensureSiteDailyData(
  db: Database,
  opts: { apiKey: string; siteId: string; city: string },
  fromDate: string,
  toDate: string,
): Promise<string[]> {
  const existing = await db.select({ date: siteDailyMetrics.date })
    .from(siteDailyMetrics)
    .where(and(
      eq(siteDailyMetrics.city, opts.city),
      sql`${siteDailyMetrics.date} >= ${fromDate}`,
      sql`${siteDailyMetrics.date} <= ${toDate}`,
    ));

  const existingDates = new Set(existing.map(r => r.date));
  const allDates = buildDateSet(fromDate, toDate);
  const missing = [...allDates].filter(d => !existingDates.has(d));

  if (missing.length === 0) return [];

  // Fetch all missing ranges in parallel
  const ranges = findContiguousRanges(missing);
  const backfilled: string[] = [];

  const results = await Promise.all(ranges.map(([rangeFrom, rangeTo]) =>
    queryPlausible(opts.apiKey, {
      siteId: opts.siteId,
      metrics: ['pageviews', 'visitors', 'visit_duration', 'bounce_rate'],
      dateRange: [rangeFrom, rangeTo],
      dimensions: ['time:day'],
    })
  ));

  for (const rows of results) {
    const dailyMetrics = processDailyAggregate(rows, opts.city);
    if (dailyMetrics.length > 0) {
      await upsertDailyRows(db, dailyMetrics);
      backfilled.push(...dailyMetrics.map(r => r.date));
    }
  }

  return backfilled;
}

/**
 * Ensure content_page_metrics has daily data for a specific content item.
 * Finds missing dates, fetches only those from Plausible.
 */
export async function ensurePageDailyData(
  db: Database,
  opts: { apiKey: string; siteId: string; city: string; locales: string[]; defaultLocale: string; redirects?: Record<string, string> },
  contentType: string,
  contentSlug: string,
  fromDate: string,
  toDate: string,
): Promise<number> {
  const paths = buildPagePaths(contentType, contentSlug);
  if (paths.length === 0) return 0;

  const existing = await db.select({ date: contentPageMetrics.date })
    .from(contentPageMetrics)
    .where(and(
      eq(contentPageMetrics.city, opts.city),
      eq(contentPageMetrics.contentType, contentType),
      eq(contentPageMetrics.contentSlug, contentSlug),
      sql`${contentPageMetrics.date} >= ${fromDate}`,
      sql`${contentPageMetrics.date} <= ${toDate}`,
    ));

  const existingDates = new Set(existing.map(r => r.date));
  const allDates = buildDateSet(fromDate, toDate);
  const missing = [...allDates].filter(d => !existingDates.has(d));

  if (missing.length === 0) return 0;

  // Fetch all missing ranges in parallel
  const ranges = findContiguousRanges(missing);
  let totalRows = 0;

  const results = await Promise.all(ranges.map(([rangeFrom, rangeTo]) =>
    queryPlausible(opts.apiKey, {
      siteId: opts.siteId,
      metrics: ['pageviews', 'visitors', 'visit_duration', 'bounce_rate'],
      dateRange: [rangeFrom, rangeTo],
      dimensions: ['time:day', 'event:page'],
      filters: [['contains', 'event:page', paths]],
      pagination: { limit: 10000 },
    })
  ));

  for (const rows of results) {
    const { contentRows } = processPageDaily(
      rows, opts.city, {}, opts.redirects ?? {}, opts.locales, opts.defaultLocale,
    );

    if (contentRows.length > 0) {
      await upsertContentRows(db, contentRows);
      totalRows += contentRows.length;
    }
  }

  // Rebuild engagement scores if new data was fetched
  if (totalRows > 0) {
    await rebuildEngagement(db, opts.city);
  }

  return totalRows;
}

// ── Legacy runSync (sync API endpoint) ──────────────────────────────

export async function runSync(db: Database, opts: SyncOptions): Promise<{ contentPages: number; skippedPaths: number; dailyRows: number }> {
  const result = await syncSiteMetrics(db, opts);
  return { contentPages: result.contentPages, skippedPaths: 0, dailyRows: result.dailyRows };
}
