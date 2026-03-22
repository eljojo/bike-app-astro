import type { InsightCard } from './types';

/** Shape of a content_engagement table row, as consumed by the insights engine. */
export interface EngagementRow {
  contentType: string;
  contentSlug: string;
  totalPageviews: number;
  totalVisitorDays: number;
  avgVisitDuration: number;  // seconds
  avgBounceRate: number;     // 0–100
  stars: number;
  videoPlayRate: number;     // 0–1
  mapConversionRate: number; // 0–1
  wallTimeHours: number;
  engagementScore: number;   // 0–1
}

/** Median values for numeric fields across all rows. */
export interface MedianValues {
  totalPageviews: number;
  totalVisitorDays: number;
  avgVisitDuration: number;
  avgBounceRate: number;
  stars: number;
  videoPlayRate: number;
  mapConversionRate: number;
  wallTimeHours: number;
  engagementScore: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Compute median values across all engagement rows. */
export function computeMedians(rows: EngagementRow[]): MedianValues {
  return {
    totalPageviews: median(rows.map(r => r.totalPageviews)),
    totalVisitorDays: median(rows.map(r => r.totalVisitorDays)),
    avgVisitDuration: median(rows.map(r => r.avgVisitDuration)),
    avgBounceRate: median(rows.map(r => r.avgBounceRate)),
    stars: median(rows.map(r => r.stars)),
    videoPlayRate: median(rows.map(r => r.videoPlayRate)),
    mapConversionRate: median(rows.map(r => r.mapConversionRate)),
    wallTimeHours: median(rows.map(r => r.wallTimeHours)),
    engagementScore: median(rows.map(r => r.engagementScore)),
  };
}

function formatDuration(seconds: number): string {
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function detectHiddenGem(row: EngagementRow, medians: MedianValues): InsightCard | null {
  const highDuration = row.avgVisitDuration > medians.avgVisitDuration * 1.5;
  const lowViews = row.totalPageviews < medians.totalPageviews;
  if (!highDuration || !lowViews) return null;

  const duration = formatDuration(row.avgVisitDuration);
  return {
    type: 'hidden-gem',
    severity: 'positive',
    title: 'Hidden gem',
    body: `${row.contentSlug} gets fewer views than average but visitors spend ${duration} per visit — longest on the site. The content is engaging, it just needs more visibility.`,
    contentType: row.contentType,
    contentSlug: row.contentSlug,
  };
}

function detectNeedsWork(row: EngagementRow, medians: MedianValues): InsightCard | null {
  const highViews = row.totalPageviews > medians.totalPageviews;
  const lowDuration = row.avgVisitDuration < medians.avgVisitDuration * 0.7;
  const highBounce = row.avgBounceRate > medians.avgBounceRate * 1.3;
  const lowStars = row.stars < medians.stars;

  if (!highViews || (!lowDuration && !highBounce) || !lowStars) return null;

  const wallTime = formatDuration(row.wallTimeHours * 3600);
  const avgDuration = formatDuration(row.avgVisitDuration);
  return {
    type: 'needs-work',
    severity: 'warning',
    title: 'Needs work',
    body: `${row.contentSlug} has ${row.totalPageviews} views but only ${wallTime} wall time (${avgDuration} avg) and ${Math.round(row.avgBounceRate)}% bounce rate. People land and leave — the page may need better photos or a clearer description.`,
    contentType: row.contentType,
    contentSlug: row.contentSlug,
  };
}

function detectStrongPerformer(row: EngagementRow, rows: EngagementRow[]): InsightCard | null {
  // Top 10% by engagement score
  const sorted = [...rows].sort((a, b) => a.engagementScore - b.engagementScore);
  const threshold = sorted[Math.floor(sorted.length * 0.9)]?.engagementScore ?? Infinity;
  if (row.engagementScore < threshold) return null;

  return {
    type: 'strong-performer',
    severity: 'positive',
    title: 'Strong performer',
    body: `${row.contentSlug} is in the top 10% across engagement metrics — wall time, map conversion, stars, and video plays all signal high interest.`,
    contentType: row.contentType,
    contentSlug: row.contentSlug,
  };
}

function detectVideosWorking(row: EngagementRow, medians: MedianValues): InsightCard | null {
  if (medians.videoPlayRate === 0) return null;
  if (row.videoPlayRate <= medians.videoPlayRate * 1.5) return null;

  const pct = Math.round(row.videoPlayRate * 100);
  return {
    type: 'videos-working',
    severity: 'positive',
    title: 'Video is working',
    body: `${pct}% of visitors play the video on ${row.contentSlug} — well above average. The thumbnail is compelling.`,
    contentType: row.contentType,
    contentSlug: row.contentSlug,
  };
}

/**
 * Compute insight cards for a set of engagement rows.
 *
 * Priority order (first match wins per content item):
 *   1. hidden-gem
 *   2. needs-work
 *   3. strong-performer
 *   4. videos-working
 *
 * Trending/declining require period comparison data not available here —
 * those are added in the API layer.
 */
export function computeInsights(rows: EngagementRow[], medians: MedianValues): InsightCard[] {
  const results: InsightCard[] = [];

  for (const row of rows) {
    const insight =
      detectHiddenGem(row, medians) ??
      detectNeedsWork(row, medians) ??
      detectStrongPerformer(row, rows) ??
      detectVideosWorking(row, medians);

    if (insight) {
      results.push(insight);
    }
  }

  return results;
}
