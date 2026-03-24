import type { APIContext } from 'astro';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { getInstanceFeatures } from '../../lib/config/instance-features';
import { db } from '../../lib/get-db';
import { CITY } from '../../lib/config/config';
import { granularityForRange, getStartDate, type TimeRange, type SummaryCard, type TimeSeriesPoint, type LeaderboardEntry } from '../../lib/stats/types';
import { computeInsights, computeMedians, type EngagementRow } from '../../lib/stats/insights';
import { fetchJson } from '../../lib/content/load-admin-content.server';
import { buildSyncContext } from '../../lib/stats/sync-context.server';
import { getCityConfig } from '../../lib/config/city-config';
import { ensureSiteDailyData, ensureSiteEventData, syncSiteMetrics } from '../../lib/stats/sync.server';
import { seedFromFixtures } from '../../lib/stats/seed-fixtures.server';
import {
  queryEngagementCount, queryTotalsAge, deleteAllAnalyticsForCity,
  querySiteSummary, querySiteTimeSeries, queryContentCount,
  queryTopByViews, queryTopByEngagement, queryAllEngagement,
  queryReactionsByType, queryLastSyncedDate,
  querySignups, queryEventMetrics,
  queryPerContentPeriodPageviews, queryMonthlyPageviews, queryVariantViews,
} from '../../lib/stats/queries.server';

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
      const engagementCount = await queryEngagementCount(database, CITY);

      const needsFullSync = forceSync || engagementCount === 0;

      if (needsFullSync) {
        if (forceSync) {
          // Force re-sync: clear ALL analytics data for this city, then rebuild
          await deleteAllAnalyticsForCity(database, CITY);
        }
        // Full site sync: daily aggregates + page breakdown + engagement rebuild
        await syncSiteMetrics(database, { ...ctx, full: forceSync });
      } else {
        // Incremental: just backfill missing daily rows
        await ensureSiteDailyData(database, ctx, startStr, endStr);

        // Check if content_totals are stale (>24h old) — if so, refresh
        // totals + engagement so they don't go permanently stale after first sync
        const totalsAge = await queryTotalsAge(database, CITY);

        const totalsStale = totalsAge === null ||
          (Date.now() - new Date(totalsAge).getTime()) > 24 * 60 * 60 * 1000;

        if (totalsStale) {
          await syncSiteMetrics(database, ctx);
        }
      }

      // Ensure event metrics (repeat visits, social referrals) are synced
      await ensureSiteEventData(database, ctx, startStr, endStr);
    }

    const [
      siteSummary,
      contentCount,
      dailyData,
      topByViews,
      topByEngagement,
      engagementRows,
      reactionsByTypeMap,
      lastSynced,
      routeNames,
      eventNames,
      signupsByDate,
      repeatVisitMap,
      socialReferralMap,
      currentPeriodMap,
      prevPeriodMap,
      monthlyMap,
      variantMap,
    ] = await Promise.all([
      // 1+2. Current + previous period summary
      querySiteSummary(database, CITY, startStr, endStr, prevStartStr, prevEndStr),
      // 3. Content count
      queryContentCount(database, CITY),
      // 4. Time series
      querySiteTimeSeries(database, CITY, startStr, endStr),
      // 5. Top by views
      queryTopByViews(database, CITY, 10),
      // 6. Top by engagement
      queryTopByEngagement(database, CITY, 10),
      // 7. All engagement (for insights)
      queryAllEngagement(database, CITY),
      // 8. Reactions
      queryReactionsByType(database, CITY),
      // 9. Last synced
      queryLastSyncedDate(database, CITY),
      // 10-11. Content names + thumbnails from static JSON
      fetchJson<Array<{ slug: string; name: string; coverKey?: string }>>(new URL('/admin/data/routes.json', baseUrl)).catch(() => [] as Array<{ slug: string; name: string; coverKey?: string }>),
      features.hasEvents
        ? fetchJson<{ events: Array<{ id: string; name: string; poster_key?: string }>; organizers: Array<{ slug: string; name: string; photo_key?: string }> }>(new URL('/admin/data/events.json', baseUrl)).catch(() => ({ events: [], organizers: [] }))
        : Promise.resolve({ events: [] as Array<{ id: string; name: string; poster_key?: string }>, organizers: [] as Array<{ slug: string; name: string; photo_key?: string }> }),
      // 12. Signups over time (guests + registered)
      querySignups(database, startStr, endStr),
      // 13. Repeat visit event metrics
      queryEventMetrics(database, CITY, 'repeat_visit', startStr, endStr),
      // 14. Social referral event metrics
      queryEventMetrics(database, CITY, 'social_referral', startStr, endStr),
      // 15. Per-content pageviews in current period (for trending/declining)
      queryPerContentPeriodPageviews(database, CITY, startStr, endStr),
      // 16. Per-content pageviews in previous period (for trending/declining)
      queryPerContentPeriodPageviews(database, CITY, prevStartStr, prevEndStr),
      // 17. Monthly pageviews per content item (for seasonal insight — all time, no date filter)
      queryMonthlyPageviews(database, CITY, '2000-01-01', endStr),
      // 18. Variant views per content item (for underused-variant insight)
      queryVariantViews(database, CITY),
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
    const newAccountsCount = signupsByDate
      .filter(r => r.role !== 'guest')
      .reduce((sum, r) => sum + r.count, 0);

    // Compute total reactions from source table
    const totalReactionsCount = Object.values(reactionsByTypeMap).reduce((sum, c) => sum + c, 0);

    const summaryCards: SummaryCard[] = [
      { label: 'Page views', value: siteSummary.totalPageviews, change: siteSummary.pctChange ?? undefined, description: 'Total page views across the site' },
      { label: 'Visitors', value: siteSummary.totalVisitors, description: 'Unique visitors (daily count, summed)' },
      { label: 'New accounts', value: newAccountsCount, description: 'New registered users (non-guest)' },
      { label: 'Reactions', value: totalReactionsCount, description: 'Stars and other reactions' },
      { label: 'Content tracked', value: contentCount, description: 'Routes, events, and communities with analytics' },
    ];

    const timeSeries: TimeSeriesPoint[] = dailyData.map(d => ({
      date: d.date, value: d.pageviews, secondaryValue: d.visitors,
    }));

    // For the site-wide daily aggregate, Plausible's visit_duration IS the average per visit (in seconds)
    const durationSeries: TimeSeriesPoint[] = dailyData.map(d => ({
      date: d.date, value: Math.round(d.totalDurationS),
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

    const insightInput: EngagementRow[] = engagementRows.map(r => {
      const key = `${r.contentType}:${r.contentSlug}`;
      return {
        contentType: r.contentType, contentSlug: r.contentSlug,
        totalPageviews: r.totalPageviews, totalVisitorDays: r.totalVisitorDays,
        avgVisitDuration: r.avgVisitDuration, avgBounceRate: r.avgBounceRate,
        stars: r.stars, videoPlayRate: r.videoPlayRate,
        mapConversionRate: r.mapConversionRate, wallTimeHours: r.wallTimeHours,
        engagementScore: r.engagementScore,
        currentPeriodPageviews: currentPeriodMap[key],
        previousPeriodPageviews: prevPeriodMap[key],
        monthlyPageviews: monthlyMap[key],
        variantViews: variantMap[key],
      };
    });

    const medians = computeMedians(insightInput);
    const insights = computeInsights(insightInput, medians, contentNames).map(i => ({
      ...i,
      thumbKey: i.contentType && i.contentSlug ? contentThumbs[`${i.contentType}:${i.contentSlug}`] : undefined,
    }));
    const reactionBreakdown = reactionsByTypeMap;

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
    for (const [dimensionValue, visitors] of Object.entries(repeatVisitMap)) {
      const count = parseInt(dimensionValue, 10);
      if (isNaN(count)) continue;
      const bucket = count >= 5 ? '5+' : String(count);
      repeatVisits[bucket] = (repeatVisits[bucket] || 0) + visitors;
      totalReturning += visitors;
      totalReturnCount += visitors * count;
    }

    const socialReferrals = socialReferralMap;

    const visitorInsights = (totalReturning > 0 || Object.keys(socialReferrals).length > 0) ? {
      repeatVisits,
      returningVisitors: totalReturning,
      avgReturns: totalReturning > 0 ? Math.round((totalReturnCount / totalReturning) * 10) / 10 : 0,
      socialReferrals,
    } : null;

    return jsonResponse({
      summaryCards, timeSeries, durationSeries, pagesPerVisitSeries,
      granularity, viewsLeaderboard, engagementLeaderboard,
      insights, reactionBreakdown, signups, range,
      visitorInsights,
      cdnUrl: getCityConfig().cdn_url,
      lastSynced,
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
