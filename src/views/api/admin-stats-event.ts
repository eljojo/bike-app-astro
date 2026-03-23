import type { APIContext } from 'astro';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { getInstanceFeatures } from '../../lib/config/instance-features';
import { db } from '../../lib/get-db';
import { CITY } from '../../lib/config/config';
import { contentPageMetrics, contentEngagement, reactions } from '../../db/schema';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { granularityForRange, type TimeRange, type TimeSeriesPoint } from '../../lib/stats/types';
import { env } from '../../lib/env/env.service';
import { getCityConfig } from '../../lib/config/city-config';
import { ensurePageDailyData, syncPageMetrics } from '../../lib/stats/sync.server';
import { fetchJson } from '../../lib/content/load-admin-content.server';

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
      const redirects = await fetchJson<Record<string, string>>(new URL('/admin/data/redirects.json', url.origin)).catch(() => ({}));
      const syncOpts = {
        apiKey,
        siteId: cityConfig.plausible_domain,
        city: CITY,
        locales: cityConfig.locales ?? [cityConfig.locale],
        defaultLocale: cityConfig.locale,
        redirects,
      };

      if (forceSync) {
        await database.delete(contentPageMetrics)
          .where(and(
            eq(contentPageMetrics.city, CITY),
            eq(contentPageMetrics.contentType, 'event'),
            eq(contentPageMetrics.contentSlug, slug),
            gte(contentPageMetrics.date, startStr),
            lte(contentPageMetrics.date, endStr),
          ))
          .run();
        await syncPageMetrics(database, { ...syncOpts, contentType: 'event', contentSlug: slug });
      } else {
        await ensurePageDailyData(database, syncOpts, 'event', slug, startStr, endStr);
      }
    }

    // All queries in parallel
    const [engagement, daily, reactionData] = await Promise.all([
      // Engagement summary
      database.select()
        .from(contentEngagement)
        .where(and(
          eq(contentEngagement.city, CITY),
          eq(contentEngagement.contentType, 'event'),
          eq(contentEngagement.contentSlug, slug),
        ))
        .limit(1),
      // Time series
      database.select({
        date: contentPageMetrics.date,
        pageviews: sql<number>`SUM(${contentPageMetrics.pageviews})`,
      }).from(contentPageMetrics)
        .where(and(
          eq(contentPageMetrics.city, CITY),
          eq(contentPageMetrics.contentType, 'event'),
          eq(contentPageMetrics.contentSlug, slug),
          gte(contentPageMetrics.date, startStr),
        ))
        .groupBy(contentPageMetrics.date)
        .orderBy(contentPageMetrics.date),
      // Reactions breakdown
      database.select({
        reactionType: reactions.reactionType,
        count: sql<number>`COUNT(*)`,
      }).from(reactions)
        .where(and(
          eq(reactions.city, CITY),
          eq(reactions.contentType, 'event'),
          eq(reactions.contentSlug, slug),
        ))
        .groupBy(reactions.reactionType),
    ]);

    const eng = engagement[0];

    const heroStats = eng ? [
      { label: 'Page views', value: eng.totalPageviews, description: 'Total page views' },
      { label: 'Wall time', value: `${Math.round(eng.wallTimeHours * 10) / 10}h`, description: 'Total hours spent reading' },
      { label: 'Visitor days', value: eng.totalVisitorDays, description: 'Unique visitor-days' },
    ] : [];

    const timeSeries: TimeSeriesPoint[] = daily.map(d => ({ date: d.date, value: d.pageviews }));
    const reactionBreakdown = Object.fromEntries(reactionData.map(r => [r.reactionType, r.count]));

    return jsonResponse({
      heroStats,
      timeSeries,
      granularity: granularityForRange(range),
      range,
      reactions: reactionBreakdown,
    } as Record<string, unknown>);
  } catch (err: unknown) {
    console.error('stats event detail error:', err);
    const message = err instanceof Error ? err.message : 'Failed to load event stats';
    return jsonError(message, 500);
  }
}

export async function GET(ctx: APIContext) {
  return handleRequest(ctx.locals, ctx.url, ctx.params, false);
}

export async function POST(ctx: APIContext) {
  return handleRequest(ctx.locals, ctx.url, ctx.params, true);
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
