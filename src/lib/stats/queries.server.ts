/**
 * Stats query layer — named domain queries that return typed results.
 * API endpoints call these instead of inlining SQL.
 */
import type { Database } from '../../db';
import {
  contentDailyMetrics, contentTotals, contentEngagement,
  siteDailyMetrics, siteEventMetrics, reactions, users,
} from '../../db/schema';
import { eq, and, gte, lte, sql, desc } from 'drizzle-orm';

// ── Site-level queries (overview) ───────────────────────────────────

export interface SiteMetricsSummary {
  totalPageviews: number;
  totalVisitors: number;
  pctChange: number | null;
}

export async function querySiteSummary(
  db: Database, city: string, startStr: string, endStr: string, prevStartStr: string, prevEndStr: string,
): Promise<SiteMetricsSummary> {
  const [current, prev] = await Promise.all([
    db.select({
      totalPageviews: sql<number>`COALESCE(SUM(${siteDailyMetrics.totalPageviews}), 0)`,
      totalVisitors: sql<number>`COALESCE(SUM(${siteDailyMetrics.uniqueVisitors}), 0)`,
    }).from(siteDailyMetrics)
      .where(and(eq(siteDailyMetrics.city, city), gte(siteDailyMetrics.date, startStr), lte(siteDailyMetrics.date, endStr))),
    db.select({
      totalPageviews: sql<number>`COALESCE(SUM(${siteDailyMetrics.totalPageviews}), 0)`,
    }).from(siteDailyMetrics)
      .where(and(eq(siteDailyMetrics.city, city), gte(siteDailyMetrics.date, prevStartStr), lte(siteDailyMetrics.date, prevEndStr))),
  ]);

  const c = current[0];
  const p = prev[0];
  return {
    totalPageviews: c.totalPageviews,
    totalVisitors: c.totalVisitors,
    pctChange: p.totalPageviews > 0
      ? Math.round(((c.totalPageviews - p.totalPageviews) / p.totalPageviews) * 100)
      : null,
  };
}

export async function querySiteTimeSeries(
  db: Database, city: string, startStr: string, endStr: string,
): Promise<Array<{ date: string; pageviews: number; visitors: number; totalDurationS: number }>> {
  return db.select({
    date: siteDailyMetrics.date,
    pageviews: siteDailyMetrics.totalPageviews,
    visitors: siteDailyMetrics.uniqueVisitors,
    totalDurationS: siteDailyMetrics.totalDurationS,
  }).from(siteDailyMetrics)
    .where(and(eq(siteDailyMetrics.city, city), gte(siteDailyMetrics.date, startStr), lte(siteDailyMetrics.date, endStr)))
    .orderBy(siteDailyMetrics.date);
}

export async function queryContentCount(db: Database, city: string): Promise<number> {
  const rows = await db.select({
    count: sql<number>`COUNT(DISTINCT ${contentEngagement.contentType} || ':' || ${contentEngagement.contentSlug})`,
  }).from(contentEngagement).where(eq(contentEngagement.city, city));
  return rows[0]?.count ?? 0;
}

export async function queryLastSyncedDate(db: Database, city: string): Promise<string | null> {
  const rows = await db.select({ date: siteDailyMetrics.date })
    .from(siteDailyMetrics).where(eq(siteDailyMetrics.city, city))
    .orderBy(desc(siteDailyMetrics.date)).limit(1);
  return rows[0]?.date ?? null;
}

export async function queryEngagementCount(db: Database, city: string): Promise<number> {
  const rows = await db.select({ count: sql<number>`COUNT(*)` })
    .from(contentEngagement).where(eq(contentEngagement.city, city));
  return rows[0]?.count ?? 0;
}

export async function queryTotalsAge(db: Database, city: string): Promise<string | null> {
  const rows = await db.select({ syncedAt: contentTotals.syncedAt })
    .from(contentTotals).where(eq(contentTotals.city, city))
    .orderBy(desc(contentTotals.syncedAt)).limit(1);
  return rows[0]?.syncedAt ?? null;
}

// ── Leaderboards ────────────────────────────────────────────────────

export async function queryTopByViews(
  db: Database, city: string, limit = 10,
): Promise<Array<{ contentType: string; contentSlug: string; totalPageviews: number; wallTimeHours: number }>> {
  return db.select({
    contentType: contentEngagement.contentType,
    contentSlug: contentEngagement.contentSlug,
    totalPageviews: contentEngagement.totalPageviews,
    wallTimeHours: contentEngagement.wallTimeHours,
  }).from(contentEngagement)
    .where(eq(contentEngagement.city, city))
    .orderBy(desc(contentEngagement.totalPageviews))
    .limit(limit);
}

export async function queryTopByEngagement(
  db: Database, city: string, limit = 10,
) {
  return db.select({
    contentType: contentEngagement.contentType,
    contentSlug: contentEngagement.contentSlug,
    engagementScore: contentEngagement.engagementScore,
    totalPageviews: contentEngagement.totalPageviews,
    wallTimeHours: contentEngagement.wallTimeHours,
    mapConversionRate: contentEngagement.mapConversionRate,
    stars: contentEngagement.stars,
    videoPlayRate: contentEngagement.videoPlayRate,
  }).from(contentEngagement)
    .where(eq(contentEngagement.city, city))
    .orderBy(desc(contentEngagement.engagementScore))
    .limit(limit);
}

// ── Engagement rows (for insights) ──────────────────────────────────

export async function queryAllEngagement(db: Database, city: string) {
  return db.select().from(contentEngagement).where(eq(contentEngagement.city, city));
}

// ── Reactions ───────────────────────────────────────────────────────

export async function queryReactionsByType(
  db: Database, city: string,
): Promise<Record<string, number>> {
  const rows = await db.select({
    reactionType: reactions.reactionType,
    count: sql<number>`COUNT(*)`,
  }).from(reactions)
    .where(eq(reactions.city, city))
    .groupBy(reactions.reactionType);
  return Object.fromEntries(rows.map(r => [r.reactionType, r.count]));
}

export async function queryReactionsForContent(
  db: Database, city: string, contentType: string, contentSlug: string,
): Promise<Record<string, number>> {
  const rows = await db.select({
    reactionType: reactions.reactionType,
    count: sql<number>`COUNT(*)`,
  }).from(reactions)
    .where(and(
      eq(reactions.city, city),
      eq(reactions.contentType, contentType),
      eq(reactions.contentSlug, contentSlug),
    ))
    .groupBy(reactions.reactionType);
  return Object.fromEntries(rows.map(r => [r.reactionType, r.count]));
}

// ── Signups ─────────────────────────────────────────────────────────

export async function querySignups(
  db: Database, startStr: string, endStr: string,
): Promise<Array<{ date: string; role: string; count: number }>> {
  return db.select({
    date: sql<string>`DATE(${users.createdAt})`,
    role: users.role,
    count: sql<number>`COUNT(*)`,
  }).from(users)
    .where(and(
      sql`DATE(${users.createdAt}) >= ${startStr}`,
      sql`DATE(${users.createdAt}) <= ${endStr}`,
    ))
    .groupBy(sql`DATE(${users.createdAt})`, users.role)
    .orderBy(sql`DATE(${users.createdAt})`);
}

// ── Event metrics (repeat visits, social referrals) ─────────────────

export async function queryEventMetrics(
  db: Database, city: string, eventName: string, startStr: string, endStr: string,
): Promise<Record<string, number>> {
  const rows = await db.select({
    dimensionValue: siteEventMetrics.dimensionValue,
    visitors: sql<number>`SUM(${siteEventMetrics.visitors})`,
  }).from(siteEventMetrics)
    .where(and(
      eq(siteEventMetrics.city, city),
      eq(siteEventMetrics.eventName, eventName),
      gte(siteEventMetrics.date, startStr),
      lte(siteEventMetrics.date, endStr),
    ))
    .groupBy(siteEventMetrics.dimensionValue);
  return Object.fromEntries(rows.map(r => [r.dimensionValue, r.visitors]));
}

// ── Content daily time series (drill-down) ──────────────────────────

export interface ContentDailySeries {
  date: string;
  pageviews: number;
  visitors: number;
  avgDuration: number;
  entryVisitors: number;
  gpxDownloads: number;
}

export async function queryContentTimeSeries(
  db: Database, city: string, contentType: string, contentSlug: string,
  startStr: string, endStr: string,
): Promise<ContentDailySeries[]> {
  return db.select({
    date: contentDailyMetrics.date,
    pageviews: sql<number>`SUM(${contentDailyMetrics.pageviews})`,
    visitors: sql<number>`SUM(${contentDailyMetrics.visitorDays})`,
    avgDuration: sql<number>`CASE WHEN SUM(${contentDailyMetrics.pageviews}) > 0 THEN SUM(${contentDailyMetrics.visitDurationS}) / SUM(${contentDailyMetrics.pageviews}) ELSE 0 END`,
    entryVisitors: sql<number>`COALESCE(SUM(${contentDailyMetrics.entryVisitors}), 0)`,
    gpxDownloads: sql<number>`COALESCE(SUM(${contentDailyMetrics.gpxDownloads}), 0)`,
  }).from(contentDailyMetrics)
    .where(and(
      eq(contentDailyMetrics.city, city),
      eq(contentDailyMetrics.contentType, contentType),
      eq(contentDailyMetrics.contentSlug, contentSlug),
      gte(contentDailyMetrics.date, startStr),
      lte(contentDailyMetrics.date, endStr),
    ))
    .groupBy(contentDailyMetrics.date)
    .orderBy(contentDailyMetrics.date);
}

// ── Content funnel (from totals) ────────────────────────────────────

export async function queryContentFunnel(
  db: Database, city: string, contentType: string, contentSlug: string,
): Promise<Array<{ pageType: string; total: number; avgDuration: number }>> {
  return db.select({
    pageType: contentTotals.pageType,
    total: contentTotals.pageviews,
    avgDuration: sql<number>`CASE WHEN ${contentTotals.pageviews} > 0 THEN ${contentTotals.visitDurationS} / ${contentTotals.pageviews} ELSE 0 END`,
  }).from(contentTotals)
    .where(and(
      eq(contentTotals.city, city),
      eq(contentTotals.contentType, contentType),
      eq(contentTotals.contentSlug, contentSlug),
    ));
}

// ── Content engagement (drill-down hero) ────────────────────────────

export async function queryContentEngagement(
  db: Database, city: string, contentType: string, contentSlug: string,
) {
  const rows = await db.select()
    .from(contentEngagement)
    .where(and(
      eq(contentEngagement.city, city),
      eq(contentEngagement.contentType, contentType),
      eq(contentEngagement.contentSlug, contentSlug),
    ))
    .limit(1);
  return rows[0] ?? null;
}

// ── Monthly pageviews (for seasonal insights) ───────────────────────

export async function queryMonthlyPageviews(
  db: Database, city: string, startStr: string, endStr: string,
): Promise<Record<string, number[]>> {
  const rows = await db.select({
    contentType: contentDailyMetrics.contentType,
    contentSlug: contentDailyMetrics.contentSlug,
    month: sql<string>`SUBSTR(${contentDailyMetrics.date}, 6, 2)`,
    views: sql<number>`SUM(${contentDailyMetrics.pageviews})`,
  }).from(contentDailyMetrics)
    .where(and(
      eq(contentDailyMetrics.city, city),
      gte(contentDailyMetrics.date, startStr),
      lte(contentDailyMetrics.date, endStr),
    ))
    .groupBy(contentDailyMetrics.contentType, contentDailyMetrics.contentSlug, sql`SUBSTR(${contentDailyMetrics.date}, 6, 2)`);

  const map: Record<string, number[]> = {};
  for (const row of rows) {
    const key = `${row.contentType}:${row.contentSlug}`;
    if (!map[key]) map[key] = new Array(12).fill(0);
    const monthIdx = parseInt(row.month, 10) - 1;
    if (monthIdx >= 0 && monthIdx < 12) map[key][monthIdx] = row.views;
  }
  return map;
}

// ── Variant views (for underused-variant insights) ──────────────────

export async function queryVariantViews(
  db: Database, city: string,
): Promise<Record<string, Record<string, number>>> {
  const rows = await db.select({
    contentType: contentTotals.contentType,
    contentSlug: contentTotals.contentSlug,
    pageType: contentTotals.pageType,
    pageviews: contentTotals.pageviews,
  }).from(contentTotals)
    .where(and(
      eq(contentTotals.city, city),
      sql`${contentTotals.pageType} LIKE 'map%'`,
    ));

  const map: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    const key = `${row.contentType}:${row.contentSlug}`;
    if (!map[key]) map[key] = {};
    map[key][row.pageType] = row.pageviews;
  }
  return map;
}

// ── Bulk delete for force sync ──────────────────────────────────────

export async function deleteAllAnalyticsForCity(db: Database, city: string): Promise<void> {
  await Promise.all([
    db.delete(siteDailyMetrics).where(eq(siteDailyMetrics.city, city)).run(),
    db.delete(contentDailyMetrics).where(eq(contentDailyMetrics.city, city)).run(),
    db.delete(contentTotals).where(eq(contentTotals.city, city)).run(),
    db.delete(contentEngagement).where(eq(contentEngagement.city, city)).run(),
    db.delete(siteEventMetrics).where(eq(siteEventMetrics.city, city)).run(),
  ]);
}

export async function deleteContentDailyForSlug(
  db: Database, city: string, contentType: string, contentSlug: string,
  startStr: string, endStr: string,
): Promise<void> {
  await db.delete(contentDailyMetrics)
    .where(and(
      eq(contentDailyMetrics.city, city),
      eq(contentDailyMetrics.contentType, contentType),
      eq(contentDailyMetrics.contentSlug, contentSlug),
      gte(contentDailyMetrics.date, startStr),
      lte(contentDailyMetrics.date, endStr),
    ))
    .run();
}

// ── Current period per-content pageviews (for trending/declining) ───

export async function queryPerContentPeriodPageviews(
  db: Database, city: string, startStr: string, endStr: string,
): Promise<Record<string, number>> {
  const rows = await db.select({
    contentType: contentDailyMetrics.contentType,
    contentSlug: contentDailyMetrics.contentSlug,
    total: sql<number>`SUM(${contentDailyMetrics.pageviews})`,
  }).from(contentDailyMetrics)
    .where(and(
      eq(contentDailyMetrics.city, city),
      gte(contentDailyMetrics.date, startStr),
      lte(contentDailyMetrics.date, endStr),
    ))
    .groupBy(contentDailyMetrics.contentType, contentDailyMetrics.contentSlug);

  const map: Record<string, number> = {};
  for (const row of rows) map[`${row.contentType}:${row.contentSlug}`] = row.total;
  return map;
}
