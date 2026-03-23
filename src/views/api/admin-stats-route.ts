import type { APIContext } from 'astro';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { getInstanceFeatures } from '../../lib/config/instance-features';
import { db } from '../../lib/get-db';
import { CITY } from '../../lib/config/config';
import { contentDailyMetrics, contentTotals, contentEngagement, reactions } from '../../db/schema';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { granularityForRange, getStartDate, formatDuration, type TimeRange, type TimeSeriesPoint, type FunnelStep } from '../../lib/stats/types';
import { ensurePageDailyData, ensureEntryPageData, syncPageMetrics } from '../../lib/stats/sync.server';
import { buildSyncContext } from '../../lib/stats/sync-context.server';
import { buildNarrative } from '../../lib/stats/narrative';

export const prerender = false;

async function handleRequest(locals: APIContext['locals'], url: URL, params: APIContext['params'], forceSync: boolean) {
  if (!getInstanceFeatures().hasRoutes) {
    return new Response(null, { status: 404 });
  }

  const user = authorize(locals, forceSync ? 'sync-stats' : 'view-stats');
  if (user instanceof Response) return user;

  const slug = params.slug;
  if (!slug) return jsonError('Missing slug', 400);

  const range = (url.searchParams.get('range') || '30d') as TimeRange;
  const database = db();

  try {
    const now = new Date();
    const startDate = getStartDate(now, range);
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = now.toISOString().split('T')[0];

    // Incremental sync — backfill missing dates for this slug
    const ctx = await buildSyncContext(url.origin);
    if (ctx) {
      if (forceSync) {
        await database.delete(contentDailyMetrics)
          .where(and(
            eq(contentDailyMetrics.city, CITY),
            eq(contentDailyMetrics.contentType, 'route'),
            eq(contentDailyMetrics.contentSlug, slug),
            gte(contentDailyMetrics.date, startStr),
            lte(contentDailyMetrics.date, endStr),
          ))
          .run();
        await syncPageMetrics(database, { ...ctx, contentType: 'route', contentSlug: slug });
      } else {
        await ensurePageDailyData(database, ctx, 'route', slug, startStr, endStr);
      }
      await ensureEntryPageData(database, ctx, 'route', slug, startStr, endStr);
    }

    // All queries in parallel
    const [engagement, daily, funnelData, reactionData] = await Promise.all([
      database.select()
        .from(contentEngagement)
        .where(and(
          eq(contentEngagement.city, CITY),
          eq(contentEngagement.contentType, 'route'),
          eq(contentEngagement.contentSlug, slug),
        ))
        .limit(1),
      database.select({
        date: contentDailyMetrics.date,
        pageviews: sql<number>`SUM(${contentDailyMetrics.pageviews})`,
        visitors: sql<number>`SUM(${contentDailyMetrics.visitorDays})`,
        avgDuration: sql<number>`CASE WHEN SUM(${contentDailyMetrics.pageviews}) > 0 THEN SUM(${contentDailyMetrics.pageviews} * ${contentDailyMetrics.visitDurationS}) / SUM(${contentDailyMetrics.pageviews}) ELSE 0 END`,
        entryVisitors: sql<number>`COALESCE(SUM(${contentDailyMetrics.entryVisitors}), 0)`,
      }).from(contentDailyMetrics)
        .where(and(
          eq(contentDailyMetrics.city, CITY),
          eq(contentDailyMetrics.contentType, 'route'),
          eq(contentDailyMetrics.contentSlug, slug),
          gte(contentDailyMetrics.date, startStr),
          lte(contentDailyMetrics.date, endStr),
        ))
        .groupBy(contentDailyMetrics.date)
        .orderBy(contentDailyMetrics.date),
      database.select({
        pageType: contentTotals.pageType,
        total: contentTotals.pageviews,
        avgDuration: sql<number>`CASE WHEN ${contentTotals.pageviews} > 0 THEN ${contentTotals.visitDurationS} ELSE 0 END`,
      }).from(contentTotals)
        .where(and(
          eq(contentTotals.city, CITY),
          eq(contentTotals.contentType, 'route'),
          eq(contentTotals.contentSlug, slug),
        )),
      database.select({
        reactionType: reactions.reactionType,
        count: sql<number>`COUNT(*)`,
      }).from(reactions)
        .where(and(
          eq(reactions.city, CITY),
          eq(reactions.contentType, 'route'),
          eq(reactions.contentSlug, slug),
        ))
        .groupBy(reactions.reactionType),
    ]);

    const eng = engagement[0];

    const totalEntryVisitors = daily.reduce((sum, d) => sum + (d.entryVisitors ?? 0), 0);
    const totalVisitors = daily.reduce((sum, d) => sum + (d.visitors ?? 0), 0);
    const viewsPerVisitor = totalVisitors > 0 ? Math.round((eng?.totalPageviews ?? 0) / totalVisitors * 10) / 10 : 0;
    const wallTimePerVisitor = totalVisitors > 0 ? (eng?.wallTimeHours ?? 0) / totalVisitors * 60 : 0;

    const heroStats = eng ? [
      { label: 'Page views', value: eng.totalPageviews, description: 'Total page views' },
      { label: 'Visitors', value: totalVisitors, description: 'Unique visitor-days in this period' },
      { label: 'Views/visitor', value: viewsPerVisitor, description: 'Average page views per visitor' },
      { label: 'Entry visitors', value: totalEntryVisitors, description: 'Visitors who entered the site on this page' },
      { label: 'Wall time', value: `${Math.round(eng.wallTimeHours * 10) / 10}h`, description: 'Total hours spent reading' },
      { label: 'Time/visitor', value: formatDuration(wallTimePerVisitor * 60), description: 'Wall time per visitor' },
      { label: 'Visit duration', value: formatDuration(eng.avgVisitDuration), description: 'Average time spent per visit' },
      { label: 'Map conversion', value: `${Math.round(eng.mapConversionRate * 100)}%`, description: 'Visitors who opened the map' },
      { label: 'Stars', value: eng.stars, description: 'Bookmarks by users' },
    ] : [];

    const timeSeries: TimeSeriesPoint[] = daily.map(d => ({
      date: d.date,
      value: d.pageviews,
      secondaryValue: d.visitors ?? 0,
    }));

    const durationSeries: TimeSeriesPoint[] = daily.map(d => ({
      date: d.date,
      value: Math.round(d.avgDuration ?? 0),
    }));

    const detailViews = funnelData.find(f => f.pageType === 'detail')?.total ?? 0;
    const mapEntries = funnelData.filter(f => f.pageType.startsWith('map'));
    const mapViews = mapEntries.reduce((sum, f) => sum + f.total, 0);
    const mapDuration = mapViews > 0
      ? mapEntries.reduce((sum, f) => sum + f.total * f.avgDuration, 0) / mapViews
      : 0;

    const funnel: FunnelStep[] = [
      { label: 'Detail page', count: detailViews },
      { label: 'Map page', count: mapViews, rate: detailViews > 0 ? Math.round((mapViews / detailViews) * 100) : 0 },
    ];

    const reactionBreakdown = Object.fromEntries(reactionData.map(r => [r.reactionType, r.count]));
    const totalReactions = reactionData.reduce((sum, r) => sum + r.count, 0);

    const narrative = eng ? buildNarrative({
      contentType: 'route',
      totalPageviews: eng.totalPageviews,
      totalVisitors,
      entryVisitors: totalEntryVisitors,
      wallTimeHours: eng.wallTimeHours,
      avgVisitDuration: eng.avgVisitDuration,
      mapConversionRate: eng.mapConversionRate,
      mapDurationS: mapDuration,
      stars: eng.stars,
      totalReactions,
    }) : [];

    return jsonResponse({
      heroStats, narrative, timeSeries, durationSeries,
      granularity: granularityForRange(range),
      funnel, range, reactions: reactionBreakdown,
    } as Record<string, unknown>);
  } catch (err: unknown) {
    console.error('stats route detail error:', err);
    const message = err instanceof Error ? err.message : 'Failed to load route stats';
    return jsonError(message, 500);
  }
}

export async function GET(ctx: APIContext) {
  return handleRequest(ctx.locals, ctx.url, ctx.params, false);
}

export async function POST(ctx: APIContext) {
  return handleRequest(ctx.locals, ctx.url, ctx.params, true);
}
