import type { APIContext } from 'astro';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { getInstanceFeatures } from '../../lib/config/instance-features';
import { db } from '../../lib/get-db';
import { CITY } from '../../lib/config/config';
import { contentPageMetrics, contentEngagement } from '../../db/schema';
import { eq, and, gte, sql } from 'drizzle-orm';
import { granularityForRange, type TimeRange, type TimeSeriesPoint } from '../../lib/stats/types';

export const prerender = false;

export async function GET({ locals, url, params }: APIContext) {
  if (!getInstanceFeatures().hasRoutes) {
    return new Response(null, { status: 404 });
  }

  const user = authorize(locals, 'view-stats');
  if (user instanceof Response) return user;

  const slug = params.slug;
  if (!slug) return jsonError('Missing slug', 400);

  const range = (url.searchParams.get('range') || '30d') as TimeRange;
  const database = db();

  try {
    const now = new Date();
    const startDate = getStartDate(now, range);
    const startStr = startDate.toISOString().split('T')[0];

    // Engagement summary for the organizer
    const engagement = await database.select()
      .from(contentEngagement)
      .where(and(
        eq(contentEngagement.city, CITY),
        eq(contentEngagement.contentType, 'organizer'),
        eq(contentEngagement.contentSlug, slug),
      ))
      .limit(1);

    const eng = engagement[0];

    const heroStats = eng ? [
      { label: 'Page views', value: eng.totalPageviews, description: 'Total page views' },
      { label: 'Wall time', value: `${Math.round(eng.wallTimeHours * 10) / 10}h`, description: 'Total hours spent reading' },
      { label: 'Visitor days', value: eng.totalVisitorDays, description: 'Unique visitor-days' },
    ] : [];

    // Time series
    const daily = await database.select({
      date: contentPageMetrics.date,
      pageviews: sql<number>`SUM(${contentPageMetrics.pageviews})`,
    }).from(contentPageMetrics)
      .where(and(
        eq(contentPageMetrics.city, CITY),
        eq(contentPageMetrics.contentType, 'organizer'),
        eq(contentPageMetrics.contentSlug, slug),
        gte(contentPageMetrics.date, startStr),
      ))
      .groupBy(contentPageMetrics.date)
      .orderBy(contentPageMetrics.date);

    const timeSeries: TimeSeriesPoint[] = daily.map(d => ({ date: d.date, value: d.pageviews }));

    return jsonResponse({
      heroStats,
      timeSeries,
      granularity: granularityForRange(range),
      range,
    } as Record<string, unknown>);
  } catch (err: unknown) {
    console.error('stats community detail error:', err);
    const message = err instanceof Error ? err.message : 'Failed to load community stats';
    return jsonError(message, 500);
  }
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
