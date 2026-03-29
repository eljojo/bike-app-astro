/**
 * Sidebar stats queries — lightweight signals for admin list sidebars.
 * Each query returns a small array (capped at 5) for display in the sidebar.
 */
import { eq, and, desc, gte, lte, sql } from 'drizzle-orm';
import type { Database } from '../../db';
import { contentEngagement, contentDailyMetrics, contentTotals, siteEventMetrics } from '../../db/schema';

// ── Response shape ──────────────────────────────────────────────────

export interface SidebarData {
  mostViewed: Array<{ slug: string; pageviews: number }>;
  mostStarred: Array<{ slug: string; stars: number }>;
  trending: Array<{ slug: string; changePercent: number; diff: number }>;
  overlooked: Array<{ slug: string }>;
  stillVisiting: Array<{ slug: string; pageviews: number }>;
  popularTags: Array<{ tag: string; visitors: number }>;
}

// ── Queries ─────────────────────────────────────────────────────────

/** Top 5 by all-time pageviews (detail page only). */
export async function querySidebarMostViewed(
  db: Database, city: string, contentType: string,
): Promise<Array<{ slug: string; pageviews: number }>> {
  const rows = await db.select({
    slug: contentTotals.contentSlug,
    pageviews: contentTotals.pageviews,
  }).from(contentTotals)
    .where(and(
      eq(contentTotals.city, city),
      eq(contentTotals.contentType, contentType),
      eq(contentTotals.pageType, 'detail'),
    ))
    .orderBy(desc(contentTotals.pageviews))
    .limit(5);
  return rows;
}

/** Top 5 by star count. */
export async function querySidebarMostStarred(
  db: Database, city: string, contentType: string,
): Promise<Array<{ slug: string; stars: number }>> {
  const rows = await db.select({
    slug: contentEngagement.contentSlug,
    stars: contentEngagement.stars,
  }).from(contentEngagement)
    .where(and(
      eq(contentEngagement.city, city),
      eq(contentEngagement.contentType, contentType),
      sql`${contentEngagement.stars} >= 1`,
    ))
    .orderBy(desc(contentEngagement.stars))
    .limit(5);
  return rows;
}

/** Items with >= 30% pageview increase and >= 20 current views (last 30 days vs prior 30 days). */
export async function querySidebarTrending(
  db: Database, city: string, contentType: string,
  currentStart: string, currentEnd: string,
  previousStart: string, previousEnd: string,
): Promise<Array<{ slug: string; changePercent: number; diff: number }>> {
  // Aggregate current and previous period pageviews per slug
  const [currentRows, previousRows] = await Promise.all([
    db.select({
      slug: contentDailyMetrics.contentSlug,
      total: sql<number>`SUM(${contentDailyMetrics.pageviews})`,
    }).from(contentDailyMetrics)
      .where(and(
        eq(contentDailyMetrics.city, city),
        eq(contentDailyMetrics.contentType, contentType),
        gte(contentDailyMetrics.date, currentStart),
        lte(contentDailyMetrics.date, currentEnd),
      ))
      .groupBy(contentDailyMetrics.contentSlug),
    db.select({
      slug: contentDailyMetrics.contentSlug,
      total: sql<number>`SUM(${contentDailyMetrics.pageviews})`,
    }).from(contentDailyMetrics)
      .where(and(
        eq(contentDailyMetrics.city, city),
        eq(contentDailyMetrics.contentType, contentType),
        gte(contentDailyMetrics.date, previousStart),
        lte(contentDailyMetrics.date, previousEnd),
      ))
      .groupBy(contentDailyMetrics.contentSlug),
  ]);

  const prevMap = new Map(previousRows.map(r => [r.slug, r.total]));
  const trending: Array<{ slug: string; changePercent: number; diff: number }> = [];

  for (const row of currentRows) {
    if (row.total < 20) continue;
    const prev = prevMap.get(row.slug) ?? 0;
    // Require a meaningful base — otherwise it's "new", not "trending"
    if (prev < 5) continue;
    const changePercent = Math.round(((row.total - prev) / prev) * 100);
    if (changePercent >= 30) {
      const diff = row.total - prev;
      trending.push({ slug: row.slug, changePercent, diff });
    }
  }

  trending.sort((a, b) => b.changePercent - a.changePercent);
  return trending.slice(0, 5);
}

/**
 * Items where bounce rate is in top quartile OR visit duration is in bottom quartile.
 * Minimum 10 pageviews to avoid noise.
 */
export async function querySidebarOverlooked(
  db: Database, city: string, contentType: string,
): Promise<Array<{ slug: string }>> {
  // Fetch all items of this type with enough pageviews
  const rows = await db.select({
    slug: contentEngagement.contentSlug,
    bounceRate: contentEngagement.avgBounceRate,
    visitDuration: contentEngagement.avgVisitDuration,
  }).from(contentEngagement)
    .where(and(
      eq(contentEngagement.city, city),
      eq(contentEngagement.contentType, contentType),
      sql`${contentEngagement.totalPageviews} >= 10`,
    ));

  if (rows.length < 4) return [];

  // Compute quartile thresholds
  const bounceRates = rows.map(r => r.bounceRate).sort((a, b) => a - b);
  const durations = rows.map(r => r.visitDuration).sort((a, b) => a - b);
  const bounceQ3 = bounceRates[Math.floor(bounceRates.length * 0.75)];
  const durationQ1 = durations[Math.floor(durations.length * 0.25)];

  const overlooked = rows
    .filter(r => r.bounceRate >= bounceQ3 || r.visitDuration <= durationQ1)
    .map(r => ({ slug: r.slug }));

  return overlooked.slice(0, 5);
}

/** Past events still getting views in the last 30 days (minimum 10 pageviews). */
export async function querySidebarStillVisiting(
  db: Database, city: string, startDate: string, endDate: string,
): Promise<Array<{ slug: string; pageviews: number }>> {
  const rows = await db.select({
    slug: contentDailyMetrics.contentSlug,
    pageviews: sql<number>`SUM(${contentDailyMetrics.pageviews})`,
  }).from(contentDailyMetrics)
    .where(and(
      eq(contentDailyMetrics.city, city),
      eq(contentDailyMetrics.contentType, 'event'),
      gte(contentDailyMetrics.date, startDate),
      lte(contentDailyMetrics.date, endDate),
    ))
    .groupBy(contentDailyMetrics.contentSlug)
    .having(sql`SUM(${contentDailyMetrics.pageviews}) >= 10`)
    .orderBy(desc(sql`SUM(${contentDailyMetrics.pageviews})`))
    .limit(5);
  return rows;
}

/** Top tags by visitor count from "Routes: Tag Filter" Plausible events. */
export async function querySidebarPopularTags(
  db: Database, city: string,
): Promise<Array<{ tag: string; visitors: number }>> {
  const rows = await db.select({
    tag: siteEventMetrics.dimensionValue,
    visitors: sql<number>`SUM(${siteEventMetrics.visitors})`,
  }).from(siteEventMetrics)
    .where(and(
      eq(siteEventMetrics.city, city),
      eq(siteEventMetrics.eventName, 'tag_filter'),
    ))
    .groupBy(siteEventMetrics.dimensionValue)
    .orderBy(desc(sql`SUM(${siteEventMetrics.visitors})`))
    .limit(5);
  return rows;
}
