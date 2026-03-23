import type { APIContext } from 'astro';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { getInstanceFeatures } from '../../lib/config/instance-features';
import { db } from '../../lib/get-db';
import { CITY } from '../../lib/config/config';
import { contentEngagement, siteDailyMetrics, reactions, users } from '../../db/schema';
import { eq, and, gte, lte, sql, desc } from 'drizzle-orm';
import { granularityForRange, type TimeRange, type SummaryCard, type TimeSeriesPoint, type LeaderboardEntry } from '../../lib/stats/types';
import { computeInsights, computeMedians, type EngagementRow } from '../../lib/stats/insights';
import { fetchJson } from '../../lib/content/load-admin-content.server';
import { env } from '../../lib/env/env.service';
import { getCityConfig } from '../../lib/config/city-config';
import { ensureSiteDailyData } from '../../lib/stats/sync.server';
import { siteDailyMetrics as siteDailyTable } from '../../db/schema';

export const prerender = false;

async function handleRequest(locals: APIContext['locals'], url: URL, forceSync: boolean) {
  if (!getInstanceFeatures().hasRoutes) {
    return new Response(null, { status: 404 });
  }

  const user = authorize(locals, forceSync ? 'sync-stats' : 'view-stats');
  if (user instanceof Response) return user;

  const range = (url.searchParams.get('range') || '30d') as TimeRange;
  const database = db();

  try {
    // Calculate date range
    const now = new Date();
    const startDate = getStartDate(now, range);
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = now.toISOString().split('T')[0];
    const prevDuration = now.getTime() - startDate.getTime();
    const prevStart = new Date(startDate.getTime() - prevDuration);
    const prevStartStr = prevStart.toISOString().split('T')[0];
    const prevEndStr = startStr;
    const granularity = granularityForRange(range);
    const features = getInstanceFeatures();
    const baseUrl = url.origin;

    // Incremental sync — backfill missing site-level dates
    const apiKey = env.PLAUSIBLE_API_KEY;
    if (apiKey) {
      const cityConfig = getCityConfig();
      if (forceSync) {
        // Delete existing data for the range, then re-fetch
        await database.delete(siteDailyTable)
          .where(and(
            eq(siteDailyTable.city, CITY),
            sql`${siteDailyTable.date} >= ${startStr}`,
            sql`${siteDailyTable.date} <= ${endStr}`,
          ))
          .run();
      }
      await ensureSiteDailyData(database, {
        apiKey, siteId: cityConfig.plausible_domain, city: CITY,
      }, startStr, endStr);
    }

    // Fire all queries in parallel — each D1 round trip is ~30-50ms,
    // running 11 sequentially would be 400ms+ just in latency
    const [
      currentMetrics,
      prevMetrics,
      contentCount,
      dailyData,
      topByViews,
      topByEngagement,
      engagementRows,
      reactionsByType,
      lastSyncRow,
      routeNames,
      eventNames,
      signupsByDate,
    ] = await Promise.all([
      // 1. Current period summary
      database.select({
        totalPageviews: sql<number>`COALESCE(SUM(${siteDailyMetrics.totalPageviews}), 0)`,
        totalVisitors: sql<number>`COALESCE(SUM(${siteDailyMetrics.uniqueVisitors}), 0)`,
        newAccounts: sql<number>`COALESCE(SUM(${siteDailyMetrics.newAccounts}), 0)`,
        totalReactions: sql<number>`COALESCE(SUM(${siteDailyMetrics.reactionsCount}), 0)`,
      }).from(siteDailyMetrics)
        .where(and(eq(siteDailyMetrics.city, CITY), gte(siteDailyMetrics.date, startStr), lte(siteDailyMetrics.date, endStr))),
      // 2. Previous period summary
      database.select({
        totalPageviews: sql<number>`COALESCE(SUM(${siteDailyMetrics.totalPageviews}), 0)`,
      }).from(siteDailyMetrics)
        .where(and(eq(siteDailyMetrics.city, CITY), gte(siteDailyMetrics.date, prevStartStr), lte(siteDailyMetrics.date, prevEndStr))),
      // 3. Content count
      database.select({
        count: sql<number>`COUNT(DISTINCT ${contentEngagement.contentSlug})`,
      }).from(contentEngagement).where(eq(contentEngagement.city, CITY)),
      // 4. Time series
      database.select({
        date: siteDailyMetrics.date,
        pageviews: siteDailyMetrics.totalPageviews,
        visitors: siteDailyMetrics.uniqueVisitors,
        avgVisitDuration: siteDailyMetrics.avgVisitDuration,
      }).from(siteDailyMetrics)
        .where(and(eq(siteDailyMetrics.city, CITY), gte(siteDailyMetrics.date, startStr), lte(siteDailyMetrics.date, endStr)))
        .orderBy(siteDailyMetrics.date),
      // 5. Top by views
      database.select({
        contentType: contentEngagement.contentType,
        contentSlug: contentEngagement.contentSlug,
        totalPageviews: contentEngagement.totalPageviews,
        wallTimeHours: contentEngagement.wallTimeHours,
      }).from(contentEngagement).where(eq(contentEngagement.city, CITY))
        .orderBy(desc(contentEngagement.totalPageviews)).limit(10),
      // 6. Top by engagement
      database.select({
        contentType: contentEngagement.contentType,
        contentSlug: contentEngagement.contentSlug,
        engagementScore: contentEngagement.engagementScore,
        totalPageviews: contentEngagement.totalPageviews,
        wallTimeHours: contentEngagement.wallTimeHours,
        mapConversionRate: contentEngagement.mapConversionRate,
        stars: contentEngagement.stars,
        videoPlayRate: contentEngagement.videoPlayRate,
      }).from(contentEngagement).where(eq(contentEngagement.city, CITY))
        .orderBy(desc(contentEngagement.engagementScore)).limit(10),
      // 7. All engagement (for insights)
      database.select().from(contentEngagement).where(eq(contentEngagement.city, CITY)),
      // 8. Reactions
      database.select({
        reactionType: reactions.reactionType,
        count: sql<number>`COUNT(*)`,
      }).from(reactions).where(eq(reactions.city, CITY)).groupBy(reactions.reactionType),
      // 9. Last synced
      database.select({ date: siteDailyMetrics.date })
        .from(siteDailyMetrics).where(eq(siteDailyMetrics.city, CITY))
        .orderBy(desc(siteDailyMetrics.date)).limit(1),
      // 10-11. Content names from static JSON
      fetchJson<Array<{ slug: string; name: string }>>(new URL('/admin/data/routes.json', baseUrl)).catch(() => [] as Array<{ slug: string; name: string }>),
      features.hasEvents
        ? fetchJson<{ events: Array<{ id: string; name: string }>; organizers: Array<{ slug: string; name: string }> }>(new URL('/admin/data/events.json', baseUrl)).catch(() => ({ events: [], organizers: [] }))
        : Promise.resolve({ events: [] as Array<{ id: string; name: string }>, organizers: [] as Array<{ slug: string; name: string }> }),
      // 12. Signups over time (guests + registered)
      database.select({
        date: sql<string>`DATE(${users.createdAt})`,
        role: users.role,
        count: sql<number>`COUNT(*)`,
      }).from(users)
        .where(and(
          sql`DATE(${users.createdAt}) >= ${startStr}`,
          sql`DATE(${users.createdAt}) <= ${endStr}`,
        ))
        .groupBy(sql`DATE(${users.createdAt})`, users.role)
        .orderBy(sql`DATE(${users.createdAt})`),
    ]);

    // Build name lookup from parallel results
    const contentNames: Record<string, string> = {};
    for (const r of routeNames) contentNames[`route:${r.slug}`] = r.name;
    for (const e of eventNames.events) contentNames[`event:${e.id}`] = e.name;
    for (const o of eventNames.organizers) contentNames[`organizer:${o.slug}`] = o.name;

    // Assemble response
    const current = currentMetrics[0];
    const prev = prevMetrics[0];
    const pctChange = prev.totalPageviews > 0
      ? Math.round(((current.totalPageviews - prev.totalPageviews) / prev.totalPageviews) * 100)
      : null;

    const summaryCards: SummaryCard[] = [
      { label: 'Page views', value: current.totalPageviews, change: pctChange ?? undefined, description: 'Total page views across the site' },
      { label: 'Visitors', value: current.totalVisitors, description: 'Unique visitors (daily count, summed)' },
      { label: 'New accounts', value: current.newAccounts, description: 'New registered users (non-guest)' },
      { label: 'Reactions', value: current.totalReactions, description: 'Stars and other reactions' },
      { label: 'Content tracked', value: contentCount[0]?.count ?? 0, description: 'Routes, events, and communities with analytics' },
    ];

    const timeSeries: TimeSeriesPoint[] = dailyData.map(d => ({
      date: d.date, value: d.pageviews, secondaryValue: d.visitors,
    }));

    const durationSeries: TimeSeriesPoint[] = dailyData.map(d => ({
      date: d.date, value: Math.round(d.avgVisitDuration),
    }));

    const pagesPerVisitSeries: TimeSeriesPoint[] = dailyData.map(d => ({
      date: d.date, value: d.visitors > 0 ? Math.round((d.pageviews / d.visitors) * 10) / 10 : 0,
    }));

    const viewsLeaderboard: LeaderboardEntry[] = topByViews.map(r => ({
      contentType: r.contentType as 'route' | 'event' | 'organizer',
      contentSlug: r.contentSlug,
      name: contentNames[`${r.contentType}:${r.contentSlug}`] || r.contentSlug,
      primaryValue: r.totalPageviews,
      primaryLabel: 'views',
      secondaryValue: Math.round(r.wallTimeHours * 10) / 10,
      secondaryLabel: 'hours',
    }));

    const engagementLeaderboard = topByEngagement.map(r => ({
      contentType: r.contentType as 'route' | 'event' | 'organizer',
      contentSlug: r.contentSlug,
      name: contentNames[`${r.contentType}:${r.contentSlug}`] || r.contentSlug,
      primaryValue: Math.round(r.engagementScore * 100),
      primaryLabel: 'score',
      secondaryValue: r.totalPageviews,
      secondaryLabel: 'views',
      breakdown: {
        wallTime: `${Math.round(r.wallTimeHours * 10) / 10}h`,
        mapConversion: `${Math.round(r.mapConversionRate * 100)}%`,
        stars: r.stars,
        videoPlayRate: `${Math.round(r.videoPlayRate * 100)}%`,
      },
    }));

    const insightInput: EngagementRow[] = engagementRows.map(r => ({
      contentType: r.contentType, contentSlug: r.contentSlug,
      totalPageviews: r.totalPageviews, totalVisitorDays: r.totalVisitorDays,
      avgVisitDuration: r.avgVisitDuration, avgBounceRate: r.avgBounceRate,
      stars: r.stars, videoPlayRate: r.videoPlayRate,
      mapConversionRate: r.mapConversionRate, wallTimeHours: r.wallTimeHours,
      engagementScore: r.engagementScore,
    }));

    const medians = computeMedians(insightInput);
    const insights = computeInsights(insightInput, medians, contentNames);
    const reactionBreakdown = Object.fromEntries(reactionsByType.map(r => [r.reactionType, r.count]));

    // Signups over time — combine guest + registered into time series
    const signups: Array<{ date: string; guests: number; registered: number }> = [];
    const signupMap = new Map<string, { guests: number; registered: number }>();
    for (const row of signupsByDate) {
      const entry = signupMap.get(row.date) || { guests: 0, registered: 0 };
      if (row.role === 'guest') entry.guests += row.count;
      else entry.registered += row.count;
      signupMap.set(row.date, entry);
    }
    for (const [date, counts] of signupMap) {
      signups.push({ date, ...counts });
    }
    signups.sort((a, b) => a.date.localeCompare(b.date));

    return jsonResponse({
      summaryCards, timeSeries, durationSeries, pagesPerVisitSeries,
      granularity, viewsLeaderboard, engagementLeaderboard,
      insights, reactionBreakdown, signups, range,
      lastSynced: lastSyncRow[0]?.date ?? null,
    } as Record<string, unknown>);
  } catch (err: unknown) {
    console.error('stats overview error:', err);
    const message = err instanceof Error ? err.message : 'Failed to load stats';
    return jsonError(message, 500);
  }
}

export async function GET(ctx: APIContext) {
  return handleRequest(ctx.locals, ctx.url, false);
}

export async function POST(ctx: APIContext) {
  return handleRequest(ctx.locals, ctx.url, true);
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
