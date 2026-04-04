import type { Database } from '../../db';
import { sql } from 'drizzle-orm';
import type { ContentMetricRow, DailyMetricRow, TotalsRow } from './parsers.server';

// ── Batch upsert helpers ────────────────────────────────────────────
// D1 has ~30-50ms latency per query. Row-by-row inserts of 300 rows
// would take 9-15 seconds. Batching into chunks of 50 rows brings
// that down to ~6 queries = ~200ms.

export const BATCH_SIZE = 50;

/**
 * Escape single quotes for SQLite string literals.
 *
 * Why raw SQL: D1 has ~30-50ms latency per round-trip. Using parameterized
 * queries for 300+ rows individually would take 9-15 seconds. Batching rows
 * into a single INSERT with raw SQL values brings that down to ~6 queries
 * (~200ms). Drizzle's `sql` template doesn't support multi-row value lists
 * with per-row parameter binding.
 *
 * What flows through this: all string fields in analytics metric rows —
 * `city`, `contentType`, `contentSlug`, `pageType`, `date`, `eventName`,
 * and `dimensionValue`. The first five are internally derived (city config,
 * URL parsing, date formatting). `eventName` and `dimensionValue` come from
 * Plausible API responses and could theoretically contain arbitrary strings.
 *
 * Sufficiency: SQLite string literals use single-quote delimiting. Doubling
 * single quotes is the only escaping needed — there are no backslash escape
 * sequences in SQLite string literals. However, this is a maintenance risk:
 * any future caller that passes non-string-literal SQL through this function
 * (e.g., column names, table names) would not be protected. Keep inputs
 * strictly limited to VALUES clause string literals.
 */
export function esc(s: string): string {
  return s.replace(/'/g, "''");
}

/**
 * Upsert content page metric rows in batches.
 */
export async function upsertContentRows(db: Database, rows: ContentMetricRow[]): Promise<void> {
  if (rows.length === 0) return;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values = batch.map(r =>
      `('${esc(r.city)}','${esc(r.contentType)}','${esc(r.contentSlug)}','${esc(r.pageType)}','${esc(r.date)}',${r.pageviews},${r.visitorDays},${r.visitDurationS},${r.bounceRate},${r.videoPlays},${r.gpxDownloads})`
    ).join(',');

    await db.run(sql.raw(`INSERT INTO content_daily_metrics (city, content_type, content_slug, page_type, date, pageviews, visitor_days, visit_duration_s, bounce_rate, video_plays, gpx_downloads)
      VALUES ${values}
      ON CONFLICT (city, content_type, content_slug, page_type, date)
      DO UPDATE SET pageviews=excluded.pageviews, visitor_days=excluded.visitor_days, visit_duration_s=excluded.visit_duration_s, bounce_rate=excluded.bounce_rate, video_plays=excluded.video_plays, gpx_downloads=excluded.gpx_downloads`));
  }
}

/**
 * Upsert content totals rows in batches.
 */
export async function upsertTotalsRows(db: Database, rows: TotalsRow[]): Promise<void> {
  if (rows.length === 0) return;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values = batch.map(r =>
      `('${esc(r.city)}','${esc(r.contentType)}','${esc(r.contentSlug)}','${esc(r.pageType)}',${r.pageviews},${r.visitorDays},${r.visitDurationS},${r.bounceRate},${r.videoPlays},${r.gpxDownloads},'${esc(r.syncedAt)}')`
    ).join(',');

    await db.run(sql.raw(`INSERT INTO content_totals (city, content_type, content_slug, page_type, pageviews, visitor_days, visit_duration_s, bounce_rate, video_plays, gpx_downloads, synced_at)
      VALUES ${values}
      ON CONFLICT (city, content_type, content_slug, page_type)
      DO UPDATE SET pageviews=excluded.pageviews, visitor_days=excluded.visitor_days, visit_duration_s=excluded.visit_duration_s, bounce_rate=excluded.bounce_rate, video_plays=excluded.video_plays, gpx_downloads=excluded.gpx_downloads, synced_at=excluded.synced_at`));
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
      `('${esc(r.city)}','${esc(r.date)}',${r.totalPageviews},${r.uniqueVisitors},${r.totalDurationS})`
    ).join(',');

    await db.run(sql.raw(`INSERT INTO site_daily_metrics (city, date, total_pageviews, unique_visitors, total_duration_s)
      VALUES ${values}
      ON CONFLICT (city, date)
      DO UPDATE SET total_pageviews=excluded.total_pageviews, unique_visitors=excluded.unique_visitors, total_duration_s=excluded.total_duration_s`));
  }
}

export interface EventMetricRow {
  city: string;
  eventName: string;
  date: string;
  dimensionValue: string;
  visitors: number;
}

export async function upsertEventRows(db: Database, rows: EventMetricRow[]): Promise<void> {
  if (rows.length === 0) return;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values = batch.map(r =>
      `('${esc(r.city)}','${esc(r.eventName)}','${esc(r.date)}','${esc(r.dimensionValue)}',${r.visitors})`
    ).join(',');

    await db.run(sql.raw(`INSERT INTO site_event_metrics (city, event_name, date, dimension_value, visitors)
      VALUES ${values}
      ON CONFLICT (city, event_name, date, dimension_value)
      DO UPDATE SET visitors=excluded.visitors`));
  }
}
