import type { PlausibleRow } from '../external/plausible-api.server';
import { resolveUrl, detectLocale } from './url-resolver.server';

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
  gpxDownloads: number;
}

/**
 * A site daily metric row ready for DB upsert.
 */
export interface DailyMetricRow {
  city: string;
  date: string;
  totalPageviews: number;
  uniqueVisitors: number;
  totalDurationS: number;
}

/**
 * A content totals row ready for DB upsert (no date — all-time aggregate).
 */
export interface TotalsRow {
  city: string;
  contentType: string;
  contentSlug: string;
  pageType: string;
  pageviews: number;
  visitorDays: number;
  visitDurationS: number;
  bounceRate: number;
  videoPlays: number;
  gpxDownloads: number;
  syncedAt: string;
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
  videoRouteMap?: Record<string, string>,
): { contentRows: ContentMetricRow[]; skippedPaths: string[] } {
  const contentRows: ContentMetricRow[] = [];
  const skippedPaths: string[] = [];

  for (const row of rows) {
    const fullPath = row.dimensions[0];
    const [locale, pathWithoutLocale] = detectLocale(fullPath, locales, defaultLoc);
    const identity = resolveUrl(pathWithoutLocale, locale, slugAliases, redirects, videoRouteMap);

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
      gpxDownloads: 0,
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
  videoRouteMap?: Record<string, string>,
): { contentRows: ContentMetricRow[]; skippedPaths: string[] } {
  const contentRows: ContentMetricRow[] = [];
  const skippedPaths: string[] = [];

  for (const row of rows) {
    const date = row.dimensions[0];
    const fullPath = row.dimensions[1];
    const [locale, pathWithoutLocale] = detectLocale(fullPath, locales, defaultLoc);
    const identity = resolveUrl(pathWithoutLocale, locale, slugAliases, redirects, videoRouteMap);

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
      gpxDownloads: 0,
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
    totalDurationS: row.metrics[2] ?? 0,
  }));
}

/**
 * Aggregate content metric rows by (contentType, contentSlug, pageType) into totals rows.
 * Multiple Plausible paths map to the same content identity — e.g. /routes/wakefield
 * and /routes/wakefield/ both resolve to (route, wakefield, detail). Sum their metrics.
 */
export function aggregateContentRows(contentRows: ContentMetricRow[], syncedAt: string): TotalsRow[] {
  const totalsMap = new Map<string, TotalsRow>();
  for (const r of contentRows) {
    const key = `${r.contentType}:${r.contentSlug}:${r.pageType}`;
    const existing = totalsMap.get(key);
    if (existing) {
      const prevPv = existing.pageviews;
      existing.pageviews += r.pageviews;
      existing.visitorDays += r.visitorDays;
      // visitDurationS is TOTAL seconds — just sum them
      existing.visitDurationS += r.visitDurationS;
      // bounceRate IS an average — weighted merge
      const totalPv = existing.pageviews;
      if (totalPv > 0) {
        existing.bounceRate = (existing.bounceRate * prevPv + r.bounceRate * r.pageviews) / totalPv;
      }
      existing.videoPlays += r.videoPlays;
      existing.gpxDownloads += r.gpxDownloads;
    } else {
      totalsMap.set(key, {
        city: r.city,
        contentType: r.contentType,
        contentSlug: r.contentSlug,
        pageType: r.pageType,
        pageviews: r.pageviews,
        visitorDays: r.visitorDays,
        visitDurationS: r.visitDurationS,
        bounceRate: r.bounceRate,
        videoPlays: r.videoPlays,
        gpxDownloads: r.gpxDownloads,
        syncedAt,
      });
    }
  }
  return [...totalsMap.values()];
}
