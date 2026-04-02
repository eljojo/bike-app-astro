import { queryPlausible } from '../external/plausible-api.server';
import type { Database } from '../../db';
import { rebuildEngagement } from './engagement.server';
import { invalidateStatsCache, readStatsCache, writeStatsCache } from './cache.server';
import { translatePath } from '../i18n/path-translations';
import { contentDailyMetrics, contentTotals, siteDailyMetrics, siteEventMetrics } from '../../db/schema';
import { sql, eq, and, desc } from 'drizzle-orm';
import {
  processPageBreakdown,
  processPageDaily,
  processDailyAggregate,
  aggregateContentRows,
} from './parsers.server';
import {
  BATCH_SIZE,
  esc,
  upsertContentRows,
  upsertTotalsRows,
  upsertDailyRows,
  upsertEventRows,
} from './upsert.server';
import type { EventMetricRow } from './upsert.server';

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

export interface SyncOptions {
  apiKey: string;
  siteId: string;
  city: string;
  locales: string[];
  defaultLocale: string;
  redirects?: Record<string, string>;
  videoRouteMap?: Record<string, string>;
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

  const redir = opts.redirects ?? {};
  const redirCount = Object.keys(redir).length;
  const { contentRows } = processPageBreakdown(
    pageRows, opts.city, {}, redir, today, opts.locales, opts.defaultLocale, opts.videoRouteMap,
  );
  const numberedAfter = contentRows.filter(r => /^\d+-/.test(r.contentSlug)).length;
  console.log(`syncSiteMetrics: ${redirCount} redirects, ${pageRows.length} plausible rows, ${contentRows.length} content rows, ${numberedAfter} still numbered`);

  const totalsRows = aggregateContentRows(contentRows, today);

  // Delete existing totals, then insert fresh
  await db.delete(contentTotals).where(eq(contentTotals.city, opts.city)).run();

  // Batch upserts in parallel
  await Promise.all([
    dailyMetrics.length > 0 ? upsertDailyRows(db, dailyMetrics) : Promise.resolve(),
    totalsRows.length > 0 ? upsertTotalsRows(db, totalsRows) : Promise.resolve(),
  ]);

  // Rebuild engagement scores from aggregate data
  await rebuildEngagement(db, opts.city);

  // Invalidate dashboard cache
  await invalidateStatsCache(db, opts.city);

  return { dailyRows: dailyMetrics.length, contentPages: contentRows.length };
}

// ── Per-page sync (drill-down) ──────────────────────────────────────

function buildPagePaths(
  contentType: string,
  contentSlug: string,
  locales?: string[],
  defaultLocale?: string,
  redirects?: Record<string, string>,
): string[] {
  let prefix: string;
  switch (contentType) {
    case 'route': prefix = '/routes'; break;
    case 'event': prefix = '/events'; break;
    case 'organizer': prefix = '/communities'; break;
    case 'bike-path': prefix = '/bike-paths'; break;
    default: return [];
  }

  // Start with the canonical slug
  const slugs = [contentSlug];

  // Add old slugs that redirect to this canonical slug (reverse lookup)
  if (redirects) {
    for (const [oldSlug, target] of Object.entries(redirects)) {
      if (target === contentSlug) slugs.push(oldSlug);
    }
  }

  // Build paths for all slugs × all locales
  const paths: string[] = [];
  for (const slug of slugs) {
    const basePath = `${prefix}/${slug}`;
    paths.push(basePath);
    if (locales && defaultLocale) {
      for (const locale of locales) {
        if (locale !== defaultLocale) {
          const translated = translatePath(basePath, locale);
          paths.push(`/${locale}${translated}`);
        }
      }
    }
  }
  return paths;
}

/**
 * Sync daily per-page data from Plausible for a single content item.
 */
export async function syncPageMetrics(
  db: Database,
  opts: SyncOptions & { contentType: string; contentSlug: string },
): Promise<number> {
  const paths = buildPagePaths(opts.contentType, opts.contentSlug, opts.locales, opts.defaultLocale, opts.redirects);
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
    rows, opts.city, {}, opts.redirects ?? {}, opts.locales, opts.defaultLocale, opts.videoRouteMap,
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
 * Ensure content_daily_metrics has daily data for a specific content item.
 * Finds missing dates, fetches only those from Plausible.
 */
export async function ensurePageDailyData(
  db: Database,
  opts: { apiKey: string; siteId: string; city: string; locales: string[]; defaultLocale: string; redirects?: Record<string, string>; videoRouteMap?: Record<string, string> },
  contentType: string,
  contentSlug: string,
  fromDate: string,
  toDate: string,
): Promise<number> {
  const paths = buildPagePaths(contentType, contentSlug, opts.locales, opts.defaultLocale, opts.redirects);
  if (paths.length === 0) return 0;

  const existing = await db.select({ date: contentDailyMetrics.date })
    .from(contentDailyMetrics)
    .where(and(
      eq(contentDailyMetrics.city, opts.city),
      eq(contentDailyMetrics.contentType, contentType),
      eq(contentDailyMetrics.contentSlug, contentSlug),
      sql`${contentDailyMetrics.date} >= ${fromDate}`,
      sql`${contentDailyMetrics.date} <= ${toDate}`,
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
      rows, opts.city, {}, opts.redirects ?? {}, opts.locales, opts.defaultLocale, opts.videoRouteMap,
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

// ── Site event metrics sync ──────────────────────────────────────────

/**
 * Ensure site_event_metrics has data for the given date range.
 * Fetches repeat visits, social referrals from Plausible custom events.
 */
export async function ensureSiteEventData(
  db: Database,
  opts: { apiKey: string; siteId: string; city: string },
  fromDate: string,
  toDate: string,
): Promise<number> {
  // Check which dates already exist for each event type
  const [existingRepeat, existingSocial, existingTagFilter] = await Promise.all([
    db.select({ date: siteEventMetrics.date })
      .from(siteEventMetrics)
      .where(and(
        eq(siteEventMetrics.city, opts.city),
        eq(siteEventMetrics.eventName, 'repeat_visit'),
        sql`${siteEventMetrics.date} >= ${fromDate}`,
        sql`${siteEventMetrics.date} <= ${toDate}`,
      )),
    db.select({ date: siteEventMetrics.date })
      .from(siteEventMetrics)
      .where(and(
        eq(siteEventMetrics.city, opts.city),
        eq(siteEventMetrics.eventName, 'social_referral'),
        sql`${siteEventMetrics.date} >= ${fromDate}`,
        sql`${siteEventMetrics.date} <= ${toDate}`,
      )),
    db.select({ date: siteEventMetrics.date })
      .from(siteEventMetrics)
      .where(and(
        eq(siteEventMetrics.city, opts.city),
        eq(siteEventMetrics.eventName, 'tag_filter'),
        sql`${siteEventMetrics.date} >= ${fromDate}`,
        sql`${siteEventMetrics.date} <= ${toDate}`,
      )),
  ]);

  const allDates = buildDateSet(fromDate, toDate);
  const repeatExisting = new Set(existingRepeat.map(r => r.date));
  const socialExisting = new Set(existingSocial.map(r => r.date));
  const tagFilterExisting = new Set(existingTagFilter.map(r => r.date));

  const repeatMissing = [...allDates].filter(d => !repeatExisting.has(d));
  const socialMissing = [...allDates].filter(d => !socialExisting.has(d));
  const tagFilterMissing = [...allDates].filter(d => !tagFilterExisting.has(d));

  if (repeatMissing.length === 0 && socialMissing.length === 0 && tagFilterMissing.length === 0) return 0;

  // Fetch from Plausible — both event types in parallel
  const queries: Promise<EventMetricRow[]>[] = [];

  if (repeatMissing.length > 0) {
    const ranges = findContiguousRanges(repeatMissing);
    for (const [rangeFrom, rangeTo] of ranges) {
      queries.push(
        queryPlausible(opts.apiKey, {
          siteId: opts.siteId,
          metrics: ['visitors'],
          dateRange: [rangeFrom, rangeTo],
          dimensions: ['time:day', 'event:props:totalVisits'],
          filters: [['is', 'event:goal', ['Repeat Visit']]],
          pagination: { limit: 10000 },
        }).then(rows => rows.map(r => ({
          city: opts.city,
          eventName: 'repeat_visit',
          date: r.dimensions[0],
          dimensionValue: r.dimensions[1],
          visitors: r.metrics[0],
        }))).catch(() => [])
      );
    }
  }

  if (socialMissing.length > 0) {
    const ranges = findContiguousRanges(socialMissing);
    for (const [rangeFrom, rangeTo] of ranges) {
      queries.push(
        queryPlausible(opts.apiKey, {
          siteId: opts.siteId,
          metrics: ['visitors'],
          dateRange: [rangeFrom, rangeTo],
          dimensions: ['time:day', 'event:props:network'],
          filters: [['is', 'event:goal', ['Social Visit']]],
          pagination: { limit: 10000 },
        }).then(rows => rows.map(r => ({
          city: opts.city,
          eventName: 'social_referral',
          date: r.dimensions[0],
          dimensionValue: r.dimensions[1],
          visitors: r.metrics[0],
        }))).catch(() => [])
      );
    }
  }

  if (tagFilterMissing.length > 0) {
    const ranges = findContiguousRanges(tagFilterMissing);
    for (const [rangeFrom, rangeTo] of ranges) {
      queries.push(
        queryPlausible(opts.apiKey, {
          siteId: opts.siteId,
          metrics: ['visitors'],
          dateRange: [rangeFrom, rangeTo],
          dimensions: ['time:day', 'event:props:tagName'],
          filters: [['is', 'event:goal', ['Routes: Tag Filter']]],
          pagination: { limit: 10000 },
        }).then(rows => rows.map(r => ({
          city: opts.city,
          eventName: 'tag_filter',
          date: r.dimensions[0],
          dimensionValue: r.dimensions[1],
          visitors: r.metrics[0],
        }))).catch(() => [])
      );
    }
  }

  const results = await Promise.all(queries);
  const allRows = results.flat();

  if (allRows.length > 0) {
    await upsertEventRows(db, allRows);
  }

  return allRows.length;
}

/**
 * Ensure entry visitor data for a specific content item.
 * Queries Plausible with visit:entry_page dimension filtered to this slug's paths.
 */
export async function ensureEntryPageData(
  db: Database,
  opts: { apiKey: string; siteId: string; city: string; locales: string[]; defaultLocale: string; redirects?: Record<string, string> },
  contentType: string,
  contentSlug: string,
  fromDate: string,
  toDate: string,
): Promise<number> {
  const paths = buildPagePaths(contentType, contentSlug, opts.locales, opts.defaultLocale, opts.redirects);
  if (paths.length === 0) return 0;

  // Check if entry data has already been synced for this slug up to this date
  const cacheKey = `entry_synced:${contentType}:${contentSlug}`;
  const cached = await readStatsCache(db, opts.city, cacheKey);
  if (cached && typeof cached.toDate === 'string' && cached.toDate >= toDate) return 0;

  // Use the cached toDate as the start of what's missing, falling back to fromDate
  const effectiveFrom = (cached && typeof cached.toDate === 'string' && cached.toDate > fromDate)
    ? cached.toDate : fromDate;

  const allDates = buildDateSet(effectiveFrom, toDate);
  const missing = [...allDates];

  if (missing.length === 0) return 0;

  // paths already includes locale-variant URLs from buildPagePaths
  const ranges = findContiguousRanges(missing);
  let totalUpdated = 0;

  const results = await Promise.all(ranges.map(([rangeFrom, rangeTo]) =>
    queryPlausible(opts.apiKey, {
      siteId: opts.siteId,
      metrics: ['visitors'],
      dateRange: [rangeFrom, rangeTo],
      dimensions: ['time:day'],
      filters: [['is', 'visit:entry_page', paths]],
    }).catch(() => [])
  ));

  // Batch updates — collect all date/visitor pairs first
  const updates: Array<{ date: string; entryVisitors: number }> = [];
  for (const rows of results) {
    for (const row of rows) {
      updates.push({ date: row.dimensions[0], entryVisitors: row.metrics[0] });
    }
  }

  // Execute updates in parallel batches
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(u =>
      db.run(sql.raw(`UPDATE content_daily_metrics
        SET entry_visitors = ${u.entryVisitors}
        WHERE city = '${esc(opts.city)}'
          AND content_type = '${esc(contentType)}'
          AND content_slug = '${esc(contentSlug)}'
          AND date = '${esc(u.date)}'`))
    ));
  }
  totalUpdated = updates.length;

  // Record that entry data has been synced up to this date
  await writeStatsCache(db, opts.city, cacheKey, { toDate });

  return totalUpdated;
}

/**
 * Ensure GPX download counts are recorded for a specific content item.
 * Queries Plausible for Link: Click events with destination=gpx on this content's pages.
 */
export async function ensureGpxDownloadData(
  db: Database,
  opts: { apiKey: string; siteId: string; city: string; locales: string[]; defaultLocale: string; redirects?: Record<string, string>; videoRouteMap?: Record<string, string> },
  contentType: string,
  contentSlug: string,
  fromDate: string,
  toDate: string,
): Promise<number> {
  const paths = buildPagePaths(contentType, contentSlug, opts.locales, opts.defaultLocale, opts.redirects);
  if (paths.length === 0) return 0;

  // Check if GPX download data has already been synced for this slug up to this date
  const cacheKey = `gpx_synced:${contentType}:${contentSlug}`;
  const cached = await readStatsCache(db, opts.city, cacheKey);
  if (cached && typeof cached.toDate === 'string' && cached.toDate >= toDate) return 0;

  // Use the cached toDate as the start of what's missing, falling back to fromDate
  const effectiveFrom = (cached && typeof cached.toDate === 'string' && cached.toDate > fromDate)
    ? cached.toDate : fromDate;

  const allDates = buildDateSet(effectiveFrom, toDate);
  const missing = [...allDates];

  if (missing.length === 0) return 0;

  const ranges = findContiguousRanges(missing);
  let totalUpdated = 0;

  const results = await Promise.all(ranges.map(([rangeFrom, rangeTo]) =>
    queryPlausible(opts.apiKey, {
      siteId: opts.siteId,
      metrics: ['visitors'],
      dateRange: [rangeFrom, rangeTo],
      dimensions: ['time:day'],
      filters: [
        ['is', 'event:goal', ['Link: Click']],
        // Match by URL ending in .gpx — catches both old (destination=routes) and new (destination=gpx) events
        ['contains', 'event:props:url', ['.gpx']],
        ['contains', 'event:props:page', paths],
      ],
    }).catch(() => [])
  ));

  // Collect all date/count pairs
  const updates: Array<{ date: string; gpxDownloads: number }> = [];
  for (const rows of results) {
    for (const row of rows) {
      updates.push({ date: row.dimensions[0], gpxDownloads: row.metrics[0] });
    }
  }

  // Execute updates in parallel batches
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(u =>
      db.run(sql.raw(`UPDATE content_daily_metrics
        SET gpx_downloads = ${u.gpxDownloads}
        WHERE city = '${esc(opts.city)}'
          AND content_type = '${esc(contentType)}'
          AND content_slug = '${esc(contentSlug)}'
          AND date = '${esc(u.date)}'`))
    ));
  }
  totalUpdated = updates.length;

  // Record that GPX data has been synced up to this date
  await writeStatsCache(db, opts.city, cacheKey, { toDate });

  return totalUpdated;
}

// ── Legacy runSync (sync API endpoint) ──────────────────────────────

export async function runSync(db: Database, opts: SyncOptions): Promise<{ contentPages: number; skippedPaths: number; dailyRows: number }> {
  const result = await syncSiteMetrics(db, opts);
  return { contentPages: result.contentPages, skippedPaths: 0, dailyRows: result.dailyRows };
}
