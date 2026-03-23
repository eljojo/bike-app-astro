import type { APIContext } from 'astro';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { getInstanceFeatures } from '../../lib/config/instance-features';
import { db } from '../../lib/get-db';
import { CITY } from '../../lib/config/config';
import { contentPageMetrics, contentEngagement, reactions } from '../../db/schema';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { granularityForRange, type TimeRange, type TimeSeriesPoint, type FunnelStep } from '../../lib/stats/types';
import { env } from '../../lib/env/env.service';
import { getCityConfig } from '../../lib/config/city-config';
import { ensurePageDailyData, ensureEntryPageData, syncPageMetrics } from '../../lib/stats/sync.server';
import { fetchJson } from '../../lib/content/load-admin-content.server';
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
    const apiKey = env.PLAUSIBLE_API_KEY;
    if (apiKey) {
      const cityConfig = getCityConfig();
      let redirects: Record<string, string> = {};
      try {
        redirects = await fetchJson<Record<string, string>>(new URL('/admin/data/redirects.json', url.origin));
      } catch (err) {
        console.error('Failed to load redirects.json:', err);
      }
      const syncOpts = {
        apiKey,
        siteId: cityConfig.plausible_domain,
        city: CITY,
        locales: cityConfig.locales ?? [cityConfig.locale],
        defaultLocale: cityConfig.locale,
        redirects,
      };

      if (forceSync) {
        // Force re-sync: delete existing data for this slug in range, then re-fetch
        await database.delete(contentPageMetrics)
          .where(and(
            eq(contentPageMetrics.city, CITY),
            eq(contentPageMetrics.contentType, 'route'),
            eq(contentPageMetrics.contentSlug, slug),
            gte(contentPageMetrics.date, startStr),
            lte(contentPageMetrics.date, endStr),
          ))
          .run();
        await syncPageMetrics(database, { ...syncOpts, contentType: 'route', contentSlug: slug });
      } else {
        await ensurePageDailyData(database, syncOpts, 'route', slug, startStr, endStr);
      }

      // Ensure entry page data is synced
      await ensureEntryPageData(database, syncOpts, 'route', slug, startStr, endStr);
    }

    // All queries in parallel
    const [engagement, daily, funnelData, reactionData] = await Promise.all([
      // Engagement summary
      database.select()
        .from(contentEngagement)
        .where(and(
          eq(contentEngagement.city, CITY),
          eq(contentEngagement.contentType, 'route'),
          eq(contentEngagement.contentSlug, slug),
        ))
        .limit(1),
      // Time series with visitors, visit duration, and entry visitors
      database.select({
        date: contentPageMetrics.date,
        pageviews: sql<number>`SUM(${contentPageMetrics.pageviews})`,
        visitors: sql<number>`SUM(${contentPageMetrics.visitorDays})`,
        avgDuration: sql<number>`CASE WHEN SUM(${contentPageMetrics.pageviews}) > 0 THEN SUM(${contentPageMetrics.pageviews} * ${contentPageMetrics.visitDurationS}) / SUM(${contentPageMetrics.pageviews}) ELSE 0 END`,
        entryVisitors: sql<number>`COALESCE(SUM(${contentPageMetrics.entryVisitors}), 0)`,
      }).from(contentPageMetrics)
        .where(and(
          eq(contentPageMetrics.city, CITY),
          eq(contentPageMetrics.contentType, 'route'),
          eq(contentPageMetrics.contentSlug, slug),
          gte(contentPageMetrics.date, startStr),
        ))
        .groupBy(contentPageMetrics.date)
        .orderBy(contentPageMetrics.date),
      // Funnel: detail views -> map views
      database.select({
        pageType: contentPageMetrics.pageType,
        total: sql<number>`SUM(${contentPageMetrics.pageviews})`,
      }).from(contentPageMetrics)
        .where(and(
          eq(contentPageMetrics.city, CITY),
          eq(contentPageMetrics.contentType, 'route'),
          eq(contentPageMetrics.contentSlug, slug),
        ))
        .groupBy(contentPageMetrics.pageType),
      // Reactions breakdown
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
    const wallTimePerVisitor = totalVisitors > 0 ? (eng?.wallTimeHours ?? 0) / totalVisitors * 60 : 0; // minutes

    const heroStats = eng ? [
      { label: 'Page views', value: eng.totalPageviews, description: 'Total page views' },
      { label: 'Visitors', value: totalVisitors, description: 'Unique visitor-days in this period' },
      { label: 'Views/visitor', value: viewsPerVisitor, description: 'Average page views per visitor — higher means people come back (sticky content)' },
      { label: 'Entry visitors', value: totalEntryVisitors, description: 'Visitors who entered the site on this page (came from search or a direct link)' },
      { label: 'Wall time', value: `${Math.round(eng.wallTimeHours * 10) / 10}h`, description: 'Total hours spent reading' },
      { label: 'Time/visitor', value: formatDuration(wallTimePerVisitor * 60), description: 'Wall time per visitor — how much attention each person gives' },
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
    const mapViews = funnelData.filter(f => f.pageType.startsWith('map')).reduce((sum, f) => sum + f.total, 0);

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
      stars: eng.stars,
      totalReactions,
    }) : [];

    return jsonResponse({
      heroStats,
      narrative,
      timeSeries,
      durationSeries,
      granularity: granularityForRange(range),
      funnel,
      range,
      reactions: reactionBreakdown,
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

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function getStartDate(now: Date, range: TimeRange): Date {
  const d = new Date(now);
  switch (range) {
    case '30d': d.setDate(d.getDate() - 30); break;
    case '3mo': d.setMonth(d.getMonth() - 3); break;
    case '1yr': d.setFullYear(d.getFullYear() - 1); break;
    case 'all': d.setFullYear(2020); break;
  }
  return d;
}
