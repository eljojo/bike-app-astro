import type { APIContext } from 'astro';
import { authorize } from '../auth/authorize';
import { jsonResponse, jsonError } from '../api-response';
import { getInstanceFeatures } from '../config/instance-features';
import { db } from '../get-db';
import { CITY } from '../config/config';
import { granularityForRange, getStartDate, formatDuration, parseTimeRange, type TimeSeriesPoint, type FunnelStep } from './types';
import { ensurePageDailyData, ensureEntryPageData, ensureGpxDownloadData, syncPageMetrics } from './sync.server';
import { buildSyncContext } from './sync-context.server';
import { buildNarrative } from './narrative';
import {
  queryContentEngagement, queryContentTimeSeries, queryContentFunnel,
  queryReactionsForContent, deleteContentDailyForSlug,
} from './queries.server';

const CONTENT_TYPE_LABELS: Record<string, string> = {
  route: 'route',
  event: 'event',
  organizer: 'community',
};

export async function handleContentDetailRequest(
  locals: APIContext['locals'],
  url: URL,
  params: APIContext['params'],
  forceSync: boolean,
  contentType: 'route' | 'event' | 'organizer',
): Promise<Response> {
  if (!getInstanceFeatures().hasRoutes) {
    return new Response(null, { status: 404 });
  }

  const user = authorize(locals, forceSync ? 'sync-stats' : 'view-stats');
  if (user instanceof Response) return user;

  const slug = params.slug;
  if (!slug) return jsonError('Missing slug', 400);

  const range = parseTimeRange(url.searchParams.get('range'));
  if (!range) return jsonError('Invalid range', 400);
  const database = db();

  const label = CONTENT_TYPE_LABELS[contentType] ?? contentType;
  const isRoute = contentType === 'route';

  try {
    const now = new Date();
    const startDate = getStartDate(now, range);
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = now.toISOString().split('T')[0];

    // Incremental sync — backfill missing dates for this slug
    const ctx = await buildSyncContext(url.origin);
    if (ctx) {
      if (forceSync) {
        await deleteContentDailyForSlug(database, CITY, contentType, slug, startStr, endStr);
        await syncPageMetrics(database, { ...ctx, contentType, contentSlug: slug });
      } else {
        await ensurePageDailyData(database, ctx, contentType, slug, startStr, endStr);
      }
      if (isRoute) {
        await ensureEntryPageData(database, ctx, 'route', slug, startStr, endStr);
        await ensureGpxDownloadData(database, ctx, 'route', slug, startStr, endStr);
      }
    }

    // All queries in parallel
    const queries: [
      Promise<Awaited<ReturnType<typeof queryContentEngagement>>>,
      Promise<Awaited<ReturnType<typeof queryContentTimeSeries>>>,
      Promise<Awaited<ReturnType<typeof queryReactionsForContent>>>,
      Promise<Awaited<ReturnType<typeof queryContentFunnel>> | null>,
    ] = [
      queryContentEngagement(database, CITY, contentType, slug),
      queryContentTimeSeries(database, CITY, contentType, slug, startStr, endStr),
      queryReactionsForContent(database, CITY, contentType, slug),
      isRoute ? queryContentFunnel(database, CITY, 'route', slug) : Promise.resolve(null),
    ];

    const [eng, daily, reactionsByTypeMap, funnelData] = await Promise.all(queries);

    // Compute hero stats from the time-range-filtered daily data
    const totalPageviews = daily.reduce((sum, d) => sum + d.pageviews, 0);
    const totalVisitors = daily.reduce((sum, d) => sum + (d.visitors ?? 0), 0);
    const totalEntryVisitors = daily.reduce((sum, d) => sum + (d.entryVisitors ?? 0), 0);
    const wallTimeHours = daily.reduce((sum, d) => sum + (d.visitors ?? 0) * (d.avgDuration ?? 0) / 3600, 0);
    const avgVisitDuration = totalVisitors > 0
      ? daily.reduce((sum, d) => sum + (d.visitors ?? 0) * (d.avgDuration ?? 0), 0) / totalVisitors
      : 0;
    const viewsPerVisitor = totalVisitors > 0 ? Math.round(totalPageviews / totalVisitors * 10) / 10 : 0;

    let heroStats: Array<{ label: string; value: string | number; description: string }> = [];

    if (totalPageviews > 0) {
      heroStats = [
        { label: 'Page views', value: totalPageviews, description: 'Total page views in this period' },
        { label: 'Visitors', value: totalVisitors, description: 'Unique visitor-days in this period' },
        { label: 'Views/visitor', value: viewsPerVisitor, description: 'Average page views per visitor' },
        { label: 'Entry visitors', value: totalEntryVisitors, description: 'Visitors who entered the site on this page' },
        { label: 'Wall time', value: formatDuration(wallTimeHours * 3600), description: 'Total hours spent reading in this period' },
      ];

      if (isRoute) {
        const wallTimePerVisitor = totalVisitors > 0 ? wallTimeHours / totalVisitors * 60 : 0;
        const totalGpxDownloads = daily.reduce((sum, d) => sum + (d.gpxDownloads ?? 0), 0);
        heroStats.push(
          { label: 'Time/visitor', value: formatDuration(wallTimePerVisitor * 60), description: 'Wall time per visitor' },
        );
        heroStats.push(
          { label: 'Visit duration', value: formatDuration(avgVisitDuration), description: 'Average time spent per visit' },
          { label: 'Map conversion', value: eng ? `${Math.round(eng.mapConversionRate * 100)}%` : '—', description: 'Visitors who opened the map (all time)' },
          { label: 'GPX downloads', value: totalGpxDownloads, description: 'People who downloaded the GPX file' },
        );
      } else {
        heroStats.push(
          { label: 'Visit duration', value: formatDuration(avgVisitDuration), description: 'Average time spent per visit' },
        );
      }

      heroStats.push(
        { label: 'Stars', value: eng?.stars ?? 0, description: 'Bookmarks by users' },
      );
    }

    const timeSeries: TimeSeriesPoint[] = daily.map(d => ({
      date: d.date, value: d.pageviews, secondaryValue: d.visitors ?? 0,
    }));
    const durationSeries: TimeSeriesPoint[] = daily.map(d => ({
      date: d.date, value: Math.round(d.avgDuration ?? 0),
    }));

    const reactionBreakdown = reactionsByTypeMap;
    const totalReactions = Object.values(reactionsByTypeMap).reduce((sum, c) => sum + c, 0);

    // Build narrative
    let narrative: ReturnType<typeof buildNarrative> = [];
    if (isRoute) {
      if (eng) {
        const totalGpxDownloads = daily.reduce((sum, d) => sum + (d.gpxDownloads ?? 0), 0);
        const mapEntries = funnelData!.filter(f => f.pageType.startsWith('map'));
        const mapViews = mapEntries.reduce((sum, f) => sum + f.total, 0);
        const mapDuration = mapViews > 0
          ? mapEntries.reduce((sum, f) => sum + f.total * f.avgDuration, 0) / mapViews
          : 0;
        narrative = buildNarrative({
          contentType: 'route',
          totalPageviews,
          totalVisitors,
          entryVisitors: totalEntryVisitors,
          wallTimeHours,
          avgVisitDuration,
          mapConversionRate: eng.mapConversionRate,
          mapDurationS: mapDuration,
          stars: eng.stars,
          totalReactions,
          gpxDownloads: totalGpxDownloads,
        });
      }
    } else if (totalPageviews > 0) {
      narrative = buildNarrative({
        contentType,
        totalPageviews,
        totalVisitors,
        entryVisitors: totalEntryVisitors,
        wallTimeHours,
        avgVisitDuration,
        mapConversionRate: 0,
        stars: eng?.stars ?? 0,
        totalReactions,
      });
    }

    // Build funnel (route only)
    let funnel: FunnelStep[] | undefined;
    if (isRoute && funnelData) {
      const detailViews = funnelData.find(f => f.pageType === 'detail')?.total ?? 0;
      const mapEntries = funnelData.filter(f => f.pageType.startsWith('map'));
      const mapViews = mapEntries.reduce((sum, f) => sum + f.total, 0);
      funnel = [
        { label: 'Detail page', count: detailViews },
        { label: 'Map page', count: mapViews, rate: detailViews > 0 ? Math.round((mapViews / detailViews) * 100) : 0 },
      ];
    }

    const response: Record<string, unknown> = {
      heroStats,
      narrative,
      timeSeries,
      durationSeries,
      granularity: granularityForRange(range),
      range,
      reactions: reactionBreakdown,
    };
    if (funnel) response.funnel = funnel;

    return jsonResponse(response);
  } catch (err: unknown) {
    console.error(`stats ${label} detail error:`, err);
    const message = err instanceof Error ? err.message : `Failed to load ${label} stats`;
    return jsonError(message, 500);
  }
}
