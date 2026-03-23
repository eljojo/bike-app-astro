import type { APIContext } from 'astro';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { getInstanceFeatures } from '../../lib/config/instance-features';
import { db } from '../../lib/get-db';
import { CITY } from '../../lib/config/config';
import { contentEngagement, contentDailyMetrics, contentTotals, siteDailyMetrics, siteEventMetrics, reactions, users } from '../../db/schema';
import { eq, and, gte, lte, sql, desc } from 'drizzle-orm';
import { granularityForRange, getStartDate, type TimeRange, type SummaryCard, type TimeSeriesPoint, type LeaderboardEntry } from '../../lib/stats/types';
import { computeInsights, computeMedians, type EngagementRow } from '../../lib/stats/insights';
import { fetchJson } from '../../lib/content/load-admin-content.server';
import { buildSyncContext } from '../../lib/stats/sync-context.server';
import { getCityConfig } from '../../lib/config/city-config';
import { ensureSiteDailyData, ensureSiteEventData, syncSiteMetrics } from '../../lib/stats/sync.server';
import { seedFromFixtures } from '../../lib/stats/seed-fixtures.server';
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

    // Incremental sync — backfill what's missing
    const ctx = await buildSyncContext(baseUrl);
    if (!ctx) {
      // No API key — seed from fixtures in local dev
      await seedFromFixtures(database, CITY);
    } else {
      // Check if engagement data exists — if not, we need a full site sync
      // (page breakdown + engagement rebuild), not just daily aggregates
      const engagementCount = await database.select({
        count: sql<number>`COUNT(*)`,
      }).from(contentEngagement).where(eq(contentEngagement.city, CITY));

      const needsFullSync = forceSync || (engagementCount[0]?.count ?? 0) === 0;

      if (needsFullSync) {
        if (forceSync) {
          // Force re-sync: clear ALL analytics data for this city, then rebuild
          await Promise.all([
            database.delete(siteDailyTable).where(eq(siteDailyTable.city, CITY)).run(),
            database.delete(contentDailyMetrics).where(eq(contentDailyMetrics.city, CITY)).run(),
            database.delete(contentTotals).where(eq(contentTotals.city, CITY)).run(),
            database.delete(contentEngagement).where(eq(contentEngagement.city, CITY)).run(),
            database.delete(siteEventMetrics).where(eq(siteEventMetrics.city, CITY)).run(),
          ]);
        }
        // Full site sync: daily aggregates + page breakdown + engagement rebuild
        await syncSiteMetrics(database, { ...ctx, full: forceSync });
      } else {
        // Incremental: just backfill missing daily rows
        await ensureSiteDailyData(database, ctx, startStr, endStr);
      }

      // Ensure event metrics (repeat visits, social referrals) are synced
      await ensureSiteEventData(database, ctx, startStr, endStr);
    }

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
      repeatVisitRows,
      socialReferralRows,
      currentPeriodByContent,
      prevPeriodByContent,
    ] = await Promise.all([
      // 1. Current period summary
      database.select({
        totalPageviews: sql<number>`COALESCE(SUM(${siteDailyMetrics.totalPageviews}), 0)`,
        totalVisitors: sql<number>`COALESCE(SUM(${siteDailyMetrics.uniqueVisitors}), 0)`,
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
      // 10-11. Content names + thumbnails from static JSON
      fetchJson<Array<{ slug: string; name: string; coverKey?: string }>>(new URL('/admin/data/routes.json', baseUrl)).catch(() => [] as Array<{ slug: string; name: string; coverKey?: string }>),
      features.hasEvents
        ? fetchJson<{ events: Array<{ id: string; name: string; poster_key?: string }>; organizers: Array<{ slug: string; name: string; photo_key?: string }> }>(new URL('/admin/data/events.json', baseUrl)).catch(() => ({ events: [], organizers: [] }))
        : Promise.resolve({ events: [] as Array<{ id: string; name: string; poster_key?: string }>, organizers: [] as Array<{ slug: string; name: string; photo_key?: string }> }),
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
      // 13. Repeat visit event metrics from D1
      database.select({
        dimensionValue: siteEventMetrics.dimensionValue,
        visitors: sql<number>`SUM(${siteEventMetrics.visitors})`,
      }).from(siteEventMetrics)
        .where(and(
          eq(siteEventMetrics.city, CITY),
          eq(siteEventMetrics.eventName, 'repeat_visit'),
          gte(siteEventMetrics.date, startStr),
          lte(siteEventMetrics.date, endStr),
        ))
        .groupBy(siteEventMetrics.dimensionValue),
      // 14. Social referral event metrics from D1
      database.select({
        dimensionValue: siteEventMetrics.dimensionValue,
        visitors: sql<number>`SUM(${siteEventMetrics.visitors})`,
      }).from(siteEventMetrics)
        .where(and(
          eq(siteEventMetrics.city, CITY),
          eq(siteEventMetrics.eventName, 'social_referral'),
          gte(siteEventMetrics.date, startStr),
          lte(siteEventMetrics.date, endStr),
        ))
        .groupBy(siteEventMetrics.dimensionValue),
      // 15. Per-content pageviews in current period (for trending/declining)
      database.select({
        contentType: contentDailyMetrics.contentType,
        contentSlug: contentDailyMetrics.contentSlug,
        pageviews: sql<number>`COALESCE(SUM(${contentDailyMetrics.pageviews}), 0)`,
      }).from(contentDailyMetrics)
        .where(and(
          eq(contentDailyMetrics.city, CITY),
          gte(contentDailyMetrics.date, startStr),
          lte(contentDailyMetrics.date, endStr),
        ))
        .groupBy(contentDailyMetrics.contentType, contentDailyMetrics.contentSlug),
      // 16. Per-content pageviews in previous period (for trending/declining)
      database.select({
        contentType: contentDailyMetrics.contentType,
        contentSlug: contentDailyMetrics.contentSlug,
        pageviews: sql<number>`COALESCE(SUM(${contentDailyMetrics.pageviews}), 0)`,
      }).from(contentDailyMetrics)
        .where(and(
          eq(contentDailyMetrics.city, CITY),
          gte(contentDailyMetrics.date, prevStartStr),
          lte(contentDailyMetrics.date, prevEndStr),
        ))
        .groupBy(contentDailyMetrics.contentType, contentDailyMetrics.contentSlug),
    ]);

    // Build name + thumbnail lookups from parallel results
    const contentNames: Record<string, string> = {};
    const contentThumbs: Record<string, string> = {};
    for (const r of routeNames) {
      contentNames[`route:${r.slug}`] = r.name;
      if (r.coverKey) contentThumbs[`route:${r.slug}`] = r.coverKey;
    }
    for (const e of eventNames.events) {
      contentNames[`event:${e.id}`] = e.name;
      if (e.poster_key) contentThumbs[`event:${e.id}`] = e.poster_key;
    }
    for (const o of eventNames.organizers) {
      contentNames[`organizer:${o.slug}`] = o.name;
      if (o.photo_key) contentThumbs[`organizer:${o.slug}`] = o.photo_key;
    }

    // Assemble response
    const current = currentMetrics[0];
    const prev = prevMetrics[0];
    const pctChange = prev.totalPageviews > 0
      ? Math.round(((current.totalPageviews - prev.totalPageviews) / prev.totalPageviews) * 100)
      : null;

    // Compute new accounts from signups (non-guest)
    const newAccountsCount = signupsByDate
      .filter(r => r.role !== 'guest')
      .reduce((sum, r) => sum + r.count, 0);

    // Compute total reactions from source table
    const totalReactionsCount = reactionsByType.reduce((sum, r) => sum + r.count, 0);

    const summaryCards: SummaryCard[] = [
      { label: 'Page views', value: current.totalPageviews, change: pctChange ?? undefined, description: 'Total page views across the site' },
      { label: 'Visitors', value: current.totalVisitors, description: 'Unique visitors (daily count, summed)' },
      { label: 'New accounts', value: newAccountsCount, description: 'New registered users (non-guest)' },
      { label: 'Reactions', value: totalReactionsCount, description: 'Stars and other reactions' },
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
      thumbKey: contentThumbs[`${r.contentType}:${r.contentSlug}`],
      primaryValue: r.totalPageviews,
      primaryLabel: 'views',
      secondaryValue: Math.round(r.wallTimeHours * 10) / 10,
      secondaryLabel: 'hours',
    }));

    const engagementLeaderboard = topByEngagement.map(r => ({
      contentType: r.contentType as 'route' | 'event' | 'organizer',
      contentSlug: r.contentSlug,
      name: contentNames[`${r.contentType}:${r.contentSlug}`] || r.contentSlug,
      thumbKey: contentThumbs[`${r.contentType}:${r.contentSlug}`],
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

    // Build per-content period lookup maps for trending/declining
    const currentPeriodMap = new Map<string, number>();
    for (const row of currentPeriodByContent) {
      currentPeriodMap.set(`${row.contentType}:${row.contentSlug}`, row.pageviews);
    }
    const prevPeriodMap = new Map<string, number>();
    for (const row of prevPeriodByContent) {
      prevPeriodMap.set(`${row.contentType}:${row.contentSlug}`, row.pageviews);
    }

    const insightInput: EngagementRow[] = engagementRows.map(r => {
      const key = `${r.contentType}:${r.contentSlug}`;
      return {
        contentType: r.contentType, contentSlug: r.contentSlug,
        totalPageviews: r.totalPageviews, totalVisitorDays: r.totalVisitorDays,
        avgVisitDuration: r.avgVisitDuration, avgBounceRate: r.avgBounceRate,
        stars: r.stars, videoPlayRate: r.videoPlayRate,
        mapConversionRate: r.mapConversionRate, wallTimeHours: r.wallTimeHours,
        engagementScore: r.engagementScore,
        currentPeriodPageviews: currentPeriodMap.get(key),
        previousPeriodPageviews: prevPeriodMap.get(key),
      };
    });

    const medians = computeMedians(insightInput);
    const insights = computeInsights(insightInput, medians, contentNames).map(i => ({
      ...i,
      thumbKey: i.contentType && i.contentSlug ? contentThumbs[`${i.contentType}:${i.contentSlug}`] : undefined,
    }));
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

    // Build visitor insights from D1 event metrics
    const repeatVisits: Record<string, number> = {};
    let totalReturning = 0;
    let totalReturnCount = 0;
    for (const row of repeatVisitRows) {
      const count = parseInt(row.dimensionValue, 10);
      const visitors = row.visitors;
      if (isNaN(count)) continue;
      const bucket = count >= 5 ? '5+' : String(count);
      repeatVisits[bucket] = (repeatVisits[bucket] || 0) + visitors;
      totalReturning += visitors;
      totalReturnCount += visitors * count;
    }

    const socialReferrals: Record<string, number> = {};
    for (const row of socialReferralRows) {
      socialReferrals[row.dimensionValue] = row.visitors;
    }

    const visitorInsights = (totalReturning > 0 || Object.keys(socialReferrals).length > 0) ? {
      repeatVisits,
      returningVisitors: totalReturning,
      returnRate: 0,
      avgReturns: totalReturning > 0 ? Math.round((totalReturnCount / totalReturning) * 10) / 10 : 0,
      socialReferrals,
      entryPages: [] as Array<{ path: string; visitors: number }>,
    } : null;

    return jsonResponse({
      summaryCards, timeSeries, durationSeries, pagesPerVisitSeries,
      granularity, viewsLeaderboard, engagementLeaderboard,
      insights, reactionBreakdown, signups, range,
      visitorInsights,
      cdnUrl: getCityConfig().cdn_url,
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
