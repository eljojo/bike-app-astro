import type { APIContext } from 'astro';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { getInstanceFeatures } from '../../lib/config/instance-features';
import { db } from '../../lib/get-db';
import { CITY } from '../../lib/config/config';
import { granularityForRange, getStartDate, type TimeRange, type TimeSeriesPoint } from '../../lib/stats/types';
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

    const heroStats = eng ? [
      { label: 'Page views', value: eng.totalPageviews, description: 'Total page views' },
      { label: 'Wall time', value: `${Math.round(eng.wallTimeHours * 10) / 10}h`, description: 'Total hours spent reading' },
      { label: 'Visitor days', value: eng.totalVisitorDays, description: 'Unique visitor-days' },
    ] : [];

    const timeSeries: TimeSeriesPoint[] = daily.map(d => ({ date: d.date, value: d.pageviews }));
    const reactionBreakdown = reactionsByTypeMap;
    const totalReactions = Object.values(reactionsByTypeMap).reduce((sum, c) => sum + c, 0);

    const narrative = eng ? buildNarrative({
      contentType: 'organizer',
      totalPageviews: eng.totalPageviews,
      totalVisitors: eng.totalVisitorDays,
      entryVisitors: 0,
      wallTimeHours: eng.wallTimeHours,
      avgVisitDuration: eng.avgVisitDuration,
      mapConversionRate: 0,
      stars: eng.stars,
      totalReactions,
    }) : [];

    return jsonResponse({
      heroStats,
      narrative,
      timeSeries,
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
