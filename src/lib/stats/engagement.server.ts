import type { Database } from '../../db';
import { contentTotals, contentEngagement, reactions } from '../../db/schema';
import { sql, eq, and } from 'drizzle-orm';

/**
 * Normalize values to 0–1 using percentile rank within an array.
 * Ties get the same rank.
 */
function percentileRanks(values: number[]): number[] {
  if (values.length === 0) return [];
  if (values.length === 1) return [0.5];

  const sorted = [...values].sort((a, b) => a - b);
  return values.map((v) => {
    const belowCount = sorted.filter((s) => s < v).length;
    const equalCount = sorted.filter((s) => s === v).length;
    // Average rank for ties: (belowCount + (belowCount + equalCount - 1)) / 2
    return (belowCount + (belowCount + equalCount - 1)) / 2 / (values.length - 1);
  });
}

interface AggregatedContent {
  contentType: string;
  contentSlug: string;
  totalPageviews: number;
  totalVisitorDays: number;
  avgVisitDuration: number;
  avgBounceRate: number;
  wallTimeHours: number;
  videoPlayRate: number;
  mapConversionRate: number;
}

/**
 * Rebuild all engagement scores for a city.
 *
 * 1. Delete existing engagement rows for this city
 * 2. Query content_totals for per-page-type aggregates
 * 3. Query reactions for star counts
 * 4. Compute engagement score using percentile normalization within content_type
 * 5. Insert into content_engagement
 */
export async function rebuildEngagement(db: Database, city: string): Promise<void> {
  // Step 1: Delete existing engagement rows for this city
  await db.delete(contentEngagement)
    .where(eq(contentEngagement.city, city))
    .run();

  // Step 2: Query content_totals for aggregates (one row per content+pageType)
  const metricsRows = await db
    .select({
      contentType: contentTotals.contentType,
      contentSlug: contentTotals.contentSlug,
      pageType: contentTotals.pageType,
      totalPageviews: contentTotals.pageviews,
      totalVisitorDays: contentTotals.visitorDays,
      // visitDurationS is TOTAL seconds — divide by visitors for per-visit avg
      avgVisitDuration: sql<number>`CASE WHEN ${contentTotals.visitorDays} > 0 THEN ${contentTotals.visitDurationS} / ${contentTotals.visitorDays} ELSE 0 END`,
      avgBounceRate: sql<number>`CASE WHEN ${contentTotals.pageviews} > 0 THEN ${contentTotals.bounceRate} ELSE 0 END`,
      // Wall time = total seconds / 3600 (NOT pageviews * seconds, since seconds is already total)
      wallTimeHours: sql<number>`${contentTotals.visitDurationS} / 3600.0`,
      totalVideoPlays: contentTotals.videoPlays,
    })
    .from(contentTotals)
    .where(eq(contentTotals.city, city))
    .all();

  // Group by content item (type + slug), combining page types
  const contentMap = new Map<string, AggregatedContent>();
  const detailViews = new Map<string, number>();
  const mapViews = new Map<string, number>();

  for (const row of metricsRows) {
    const key = `${row.contentType}:${row.contentSlug}`;

    if (!contentMap.has(key)) {
      contentMap.set(key, {
        contentType: row.contentType,
        contentSlug: row.contentSlug,
        totalPageviews: 0,
        totalVisitorDays: 0,
        avgVisitDuration: 0,
        avgBounceRate: 0,
        wallTimeHours: 0,
        videoPlayRate: 0,
        mapConversionRate: 0,
      });
    }

    const item = contentMap.get(key)!;
    item.totalPageviews += row.totalPageviews;
    item.totalVisitorDays += row.totalVisitorDays;
    item.wallTimeHours += row.wallTimeHours;

    if (row.pageType === 'detail') {
      item.avgVisitDuration = row.avgVisitDuration;
      item.avgBounceRate = row.avgBounceRate;
      detailViews.set(key, (detailViews.get(key) || 0) + row.totalPageviews);
    }

    if (row.pageType === 'map' || (row.pageType as string).startsWith('map:')) {
      mapViews.set(key, (mapViews.get(key) || 0) + row.totalPageviews);
    }

    // Video play rate: total plays / total detail pageviews
    if (row.pageType === 'detail' && row.totalPageviews > 0) {
      item.videoPlayRate = row.totalVideoPlays / row.totalPageviews;
    }
  }

  // Compute map conversion rate (capped at 1.0)
  for (const [key, item] of contentMap) {
    const detail = detailViews.get(key) || 0;
    const map = mapViews.get(key) || 0;
    if (detail > 0) {
      item.mapConversionRate = Math.min(map / detail, 1.0);
    }
  }

  // Step 3: Query reactions for star counts
  const starRows = await db
    .select({
      contentType: reactions.contentType,
      contentSlug: reactions.contentSlug,
      stars: sql<number>`COUNT(*)`,
    })
    .from(reactions)
    .where(and(eq(reactions.city, city), eq(reactions.reactionType, 'star')))
    .groupBy(reactions.contentType, reactions.contentSlug)
    .all();

  const starMap = new Map<string, number>();
  for (const row of starRows) {
    starMap.set(`${row.contentType}:${row.contentSlug}`, row.stars);
  }

  // Step 4: Compute engagement score using percentile normalization by content_type
  const byType = new Map<string, AggregatedContent[]>();
  for (const item of contentMap.values()) {
    const list = byType.get(item.contentType) || [];
    list.push(item);
    byType.set(item.contentType, list);
  }

  const now = new Date().toISOString();

  // Collect all rows, then batch insert
  const allRows: Array<{
    city: string; contentType: string; contentSlug: string;
    totalPageviews: number; totalVisitorDays: number; avgVisitDuration: number;
    avgBounceRate: number; stars: number; videoPlayRate: number;
    mapConversionRate: number; wallTimeHours: number; engagementScore: number;
    lastSyncedAt: string;
  }> = [];

  for (const [contentType, items] of byType) {
    const wallTimes = items.map((i) => i.wallTimeHours);
    const mapRates = items.map((i) => i.mapConversionRate);
    const videoRates = items.map((i) => i.videoPlayRate);
    const starValues = items.map((i) => {
      const key = `${i.contentType}:${i.contentSlug}`;
      return starMap.get(key) || 0;
    });

    const wallTimeRanks = percentileRanks(wallTimes);
    const mapRateRanks = percentileRanks(mapRates);
    const videoRateRanks = percentileRanks(videoRates);
    const starRanks = percentileRanks(starValues);

    // Content-type-specific weights. Routes have maps; events/organizers don't.
    // For non-route types, the map weight (0.25) is redistributed proportionally.
    const hasMap = contentType === 'route';
    const weights = hasMap
      ? { wallTime: 0.4, map: 0.25, stars: 0.2, video: 0.15 }
      : { wallTime: 0.5, map: 0, stars: 0.3, video: 0.2 };

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      const key = `${item.contentType}:${item.contentSlug}`;
      const stars = starMap.get(key) || 0;

      // Engagement score: weighted sum of percentile ranks within content type.
      //
      // Weight rationale:
      //   Wall time (0.4/0.5)  — Total attention is the strongest signal of content value.
      //                          A page that holds people for minutes is doing something right.
      //   Map conversion (0.25/0) — Opening the map signals intent to ride, which is specific
      //                          to cycling and a stronger action than just reading. Events and
      //                          communities have no map, so this weight is redistributed to
      //                          wall time, stars, and video plays.
      //   Stars (0.2/0.3)      — A deliberate endorsement (bookmarking), but rare — most
      //                          content has zero stars, so fewer data points to work with.
      //   Video plays (0.15/0.2) — Video is optional and not all content has it. When present,
      //                          play rate is meaningful, but the low weight avoids penalizing
      //                          content without video.
      const engagementScore =
        wallTimeRanks[idx] * weights.wallTime +
        mapRateRanks[idx] * weights.map +
        starRanks[idx] * weights.stars +
        videoRateRanks[idx] * weights.video;

      allRows.push({
        city,
        contentType: item.contentType,
        contentSlug: item.contentSlug,
        totalPageviews: item.totalPageviews,
        totalVisitorDays: item.totalVisitorDays,
        avgVisitDuration: item.avgVisitDuration,
        avgBounceRate: item.avgBounceRate,
        stars,
        videoPlayRate: item.videoPlayRate,
        mapConversionRate: item.mapConversionRate,
        wallTimeHours: item.wallTimeHours,
        engagementScore,
        lastSyncedAt: now,
      });
    }
  }

  // Batch insert — 50 rows per query instead of 1
  const BATCH = 50;
  for (let i = 0; i < allRows.length; i += BATCH) {
    const batch = allRows.slice(i, i + BATCH);
    const esc = (s: string) => s.replace(/'/g, "''");
    const values = batch.map(r =>
      `('${esc(r.city)}','${esc(r.contentType)}','${esc(r.contentSlug)}',${r.totalPageviews},${r.totalVisitorDays},${r.avgVisitDuration},${r.avgBounceRate},${r.stars},${r.videoPlayRate},${r.mapConversionRate},${r.wallTimeHours},${r.engagementScore},'${esc(r.lastSyncedAt)}')`
    ).join(',');

    await db.run(sql.raw(`INSERT INTO content_engagement (city, content_type, content_slug, total_pageviews, total_visitor_days, avg_visit_duration, avg_bounce_rate, stars, video_play_rate, map_conversion_rate, wall_time_hours, engagement_score, last_synced_at)
      VALUES ${values}`));
  }
}
