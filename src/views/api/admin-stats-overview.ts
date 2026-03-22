import type { APIContext } from 'astro';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { getInstanceFeatures } from '../../lib/config/instance-features';
import { db } from '../../lib/get-db';
import { CITY } from '../../lib/config/config';
import { contentEngagement, siteDailyMetrics } from '../../db/schema';
import { eq, and, gte, lte, sql, desc } from 'drizzle-orm';
import { granularityForRange, type TimeRange, type SummaryCard, type TimeSeriesPoint, type LeaderboardEntry } from '../../lib/stats/types';
import { computeInsights, computeMedians, type EngagementRow } from '../../lib/stats/insights';
import { fetchJson } from '../../lib/content/load-admin-content.server';

export const prerender = false;

export async function GET({ locals, url, request }: APIContext) {
  if (!getInstanceFeatures().hasRoutes) {
    return new Response(null, { status: 404 });
  }

  const user = authorize(locals, 'view-stats');
  if (user instanceof Response) return user;

  const range = (url.searchParams.get('range') || '30d') as TimeRange;
  const database = db();

  try {
    // Calculate date range
    const now = new Date();
    const startDate = getStartDate(now, range);
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = now.toISOString().split('T')[0];

    // Previous period for comparison
    const prevDuration = now.getTime() - startDate.getTime();
    const prevStart = new Date(startDate.getTime() - prevDuration);
    const prevStartStr = prevStart.toISOString().split('T')[0];
    const prevEndStr = startStr;

    // 1. Summary cards
    const currentMetrics = await database.select({
      totalPageviews: sql<number>`COALESCE(SUM(${siteDailyMetrics.totalPageviews}), 0)`,
      totalVisitors: sql<number>`COALESCE(SUM(${siteDailyMetrics.uniqueVisitors}), 0)`,
      newAccounts: sql<number>`COALESCE(SUM(${siteDailyMetrics.newAccounts}), 0)`,
      totalReactions: sql<number>`COALESCE(SUM(${siteDailyMetrics.reactionsCount}), 0)`,
    }).from(siteDailyMetrics)
      .where(and(
        eq(siteDailyMetrics.city, CITY),
        gte(siteDailyMetrics.date, startStr),
        lte(siteDailyMetrics.date, endStr),
      ));

    const prevMetrics = await database.select({
      totalPageviews: sql<number>`COALESCE(SUM(${siteDailyMetrics.totalPageviews}), 0)`,
    }).from(siteDailyMetrics)
      .where(and(
        eq(siteDailyMetrics.city, CITY),
        gte(siteDailyMetrics.date, prevStartStr),
        lte(siteDailyMetrics.date, prevEndStr),
      ));

    const current = currentMetrics[0];
    const prev = prevMetrics[0];
    const pctChange = prev.totalPageviews > 0
      ? Math.round(((current.totalPageviews - prev.totalPageviews) / prev.totalPageviews) * 100)
      : null;

    // Count total content items tracked
    const contentCount = await database.select({
      count: sql<number>`COUNT(DISTINCT ${contentEngagement.contentSlug})`,
    }).from(contentEngagement)
      .where(eq(contentEngagement.city, CITY));

    const summaryCards: SummaryCard[] = [
      { label: 'Page views', value: current.totalPageviews, change: pctChange ?? undefined, description: 'Total page views across the site' },
      { label: 'Visitors', value: current.totalVisitors, description: 'Unique visitors (daily count, summed)' },
      { label: 'New accounts', value: current.newAccounts, description: 'New registered users (non-guest)' },
      { label: 'Reactions', value: current.totalReactions, description: 'Stars and other reactions' },
      { label: 'Content tracked', value: contentCount[0]?.count ?? 0, description: 'Routes, events, and communities with analytics' },
    ];

    // 2. Time series (daily pageviews and visitors)
    const granularity = granularityForRange(range);
    const dailyData = await database.select({
      date: siteDailyMetrics.date,
      pageviews: siteDailyMetrics.totalPageviews,
      visitors: siteDailyMetrics.uniqueVisitors,
    }).from(siteDailyMetrics)
      .where(and(
        eq(siteDailyMetrics.city, CITY),
        gte(siteDailyMetrics.date, startStr),
        lte(siteDailyMetrics.date, endStr),
      ))
      .orderBy(siteDailyMetrics.date);

    const timeSeries: TimeSeriesPoint[] = dailyData.map(d => ({
      date: d.date,
      value: d.pageviews,
      secondaryValue: d.visitors,
    }));

    // Build content name lookup
    const contentNames: Record<string, string> = {};
    try {
      const features = getInstanceFeatures();
      const baseUrl = url.origin;
      const adminRoutes = await fetchJson<Array<{ slug: string; name: string }>>(new URL('/admin/data/routes.json', baseUrl));
      for (const r of adminRoutes) contentNames[`route:${r.slug}`] = r.name;

      if (features.hasEvents) {
        const { events: adminEvents, organizers: adminOrganizers } = await fetchJson<{ events: Array<{ id: string; name: string }>; organizers: Array<{ slug: string; name: string }> }>(new URL('/admin/data/events.json', baseUrl));
        for (const e of adminEvents) contentNames[`event:${e.id}`] = e.name;
        for (const o of adminOrganizers) contentNames[`organizer:${o.slug}`] = o.name;
      }
    } catch { /* fallback to slugs */ }

    // 3. Leaderboards (top content by pageviews and engagement)
    const topByViews = await database.select({
      contentType: contentEngagement.contentType,
      contentSlug: contentEngagement.contentSlug,
      totalPageviews: contentEngagement.totalPageviews,
      wallTimeHours: contentEngagement.wallTimeHours,
    }).from(contentEngagement)
      .where(eq(contentEngagement.city, CITY))
      .orderBy(desc(contentEngagement.totalPageviews))
      .limit(10);

    const topByEngagement = await database.select({
      contentType: contentEngagement.contentType,
      contentSlug: contentEngagement.contentSlug,
      engagementScore: contentEngagement.engagementScore,
      totalPageviews: contentEngagement.totalPageviews,
    }).from(contentEngagement)
      .where(eq(contentEngagement.city, CITY))
      .orderBy(desc(contentEngagement.engagementScore))
      .limit(10);

    const viewsLeaderboard: LeaderboardEntry[] = topByViews.map(r => ({
      contentType: r.contentType as 'route' | 'event' | 'organizer',
      contentSlug: r.contentSlug,
      name: contentNames[`${r.contentType}:${r.contentSlug}`] || r.contentSlug,
      primaryValue: r.totalPageviews,
      primaryLabel: 'views',
      secondaryValue: Math.round(r.wallTimeHours * 10) / 10,
      secondaryLabel: 'hours',
    }));

    const engagementLeaderboard: LeaderboardEntry[] = topByEngagement.map(r => ({
      contentType: r.contentType as 'route' | 'event' | 'organizer',
      contentSlug: r.contentSlug,
      name: contentNames[`${r.contentType}:${r.contentSlug}`] || r.contentSlug,
      primaryValue: Math.round(r.engagementScore * 100),
      primaryLabel: 'score',
      secondaryValue: r.totalPageviews,
      secondaryLabel: 'views',
    }));

    // 4. Insights
    const engagementRows = await database.select().from(contentEngagement)
      .where(eq(contentEngagement.city, CITY));

    const insightInput: EngagementRow[] = engagementRows.map(r => ({
      contentType: r.contentType,
      contentSlug: r.contentSlug,
      totalPageviews: r.totalPageviews,
      totalVisitorDays: r.totalVisitorDays,
      avgVisitDuration: r.avgVisitDuration,
      avgBounceRate: r.avgBounceRate,
      stars: r.stars,
      videoPlayRate: r.videoPlayRate,
      mapConversionRate: r.mapConversionRate,
      wallTimeHours: r.wallTimeHours,
      engagementScore: r.engagementScore,
    }));

    const medians = computeMedians(insightInput);
    const insights = computeInsights(insightInput, medians, contentNames);

    return jsonResponse({
      summaryCards,
      timeSeries,
      granularity,
      viewsLeaderboard,
      engagementLeaderboard,
      insights,
      range,
    } as Record<string, unknown>);
  } catch (err: unknown) {
    console.error('stats overview error:', err);
    const message = err instanceof Error ? err.message : 'Failed to load stats';
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
