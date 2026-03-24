import type { APIContext } from 'astro';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { getInstanceFeatures } from '../../lib/config/instance-features';
import { db } from '../../lib/get-db';
import { CITY } from '../../lib/config/config';
import { granularityForRange, getStartDate, formatDuration, type TimeRange, type TimeSeriesPoint } from '../../lib/stats/types';
import { ensurePageDailyData, syncPageMetrics } from '../../lib/stats/sync.server';
import { buildSyncContext } from '../../lib/stats/sync-context.server';
import { buildNarrative } from '../../lib/stats/narrative';
import {
  queryContentEngagement, queryContentTimeSeries,
  queryReactionsForContent, deleteContentDailyForSlug,
} from '../../lib/stats/queries.server';

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
        await deleteContentDailyForSlug(database, CITY, 'organizer', slug, startStr, endStr);
        await syncPageMetrics(database, { ...ctx, contentType: 'organizer', contentSlug: slug });
      } else {
        await ensurePageDailyData(database, ctx, 'organizer', slug, startStr, endStr);
      }
    }

    // All queries in parallel
    const [eng, daily, reactionsByTypeMap] = await Promise.all([
      queryContentEngagement(database, CITY, 'organizer', slug),
      queryContentTimeSeries(database, CITY, 'organizer', slug, startStr, endStr),
      queryReactionsForContent(database, CITY, 'organizer', slug),
    ]);

    const totalPageviews = daily.reduce((sum, d) => sum + d.pageviews, 0);
    const totalVisitors = daily.reduce((sum, d) => sum + (d.visitors ?? 0), 0);
    const totalEntryVisitors = daily.reduce((sum, d) => sum + (d.entryVisitors ?? 0), 0);
    const wallTimeHours = daily.reduce((sum, d) => sum + (d.visitors ?? 0) * (d.avgDuration ?? 0) / 3600, 0);
    const avgVisitDuration = totalVisitors > 0
      ? daily.reduce((sum, d) => sum + (d.visitors ?? 0) * (d.avgDuration ?? 0), 0) / totalVisitors
      : 0;
    const viewsPerVisitor = totalVisitors > 0 ? Math.round(totalPageviews / totalVisitors * 10) / 10 : 0;

    const heroStats = totalPageviews > 0 ? [
      { label: 'Page views', value: totalPageviews, description: 'Total page views in this period' },
      { label: 'Visitors', value: totalVisitors, description: 'Unique visitor-days in this period' },
      { label: 'Views/visitor', value: viewsPerVisitor, description: 'Average page views per visitor' },
      { label: 'Entry visitors', value: totalEntryVisitors, description: 'Visitors who entered the site on this page' },
      { label: 'Wall time', value: `${Math.round(wallTimeHours * 10) / 10}h`, description: 'Total hours spent reading in this period' },
      { label: 'Visit duration', value: formatDuration(avgVisitDuration), description: 'Average time spent per visit' },
      { label: 'Stars', value: eng?.stars ?? 0, description: 'Bookmarks by users' },
    ] : [];

    const timeSeries: TimeSeriesPoint[] = daily.map(d => ({
      date: d.date, value: d.pageviews, secondaryValue: d.visitors ?? 0,
    }));
    const durationSeries: TimeSeriesPoint[] = daily.map(d => ({
      date: d.date, value: Math.round(d.avgDuration ?? 0),
    }));
    const reactionBreakdown = reactionsByTypeMap;
    const totalReactions = Object.values(reactionsByTypeMap).reduce((sum, c) => sum + c, 0);

    const narrative = totalPageviews > 0 ? buildNarrative({
      contentType: 'organizer',
      totalPageviews,
      totalVisitors,
      entryVisitors: totalEntryVisitors,
      wallTimeHours,
      avgVisitDuration,
      mapConversionRate: 0,
      stars: eng?.stars ?? 0,
      totalReactions,
    }) : [];

    return jsonResponse({
      heroStats,
      narrative,
      timeSeries,
      durationSeries,
      granularity: granularityForRange(range),
      range,
      reactions: reactionBreakdown,
    } as Record<string, unknown>);
  } catch (err: unknown) {
    console.error('stats community detail error:', err);
    const message = err instanceof Error ? err.message : 'Failed to load community stats';
    return jsonError(message, 500);
  }
}

export async function GET(ctx: APIContext) {
  return handleRequest(ctx.locals, ctx.url, ctx.params, false);
}

export async function POST(ctx: APIContext) {
  return handleRequest(ctx.locals, ctx.url, ctx.params, true);
}
