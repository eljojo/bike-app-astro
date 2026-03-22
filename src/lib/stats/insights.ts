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

function formatHours(h: number): string {
  return h >= 10 ? `${Math.round(h)}h` : `${Math.round(h * 10) / 10}h`;
}

/** Resolve a content slug to a human-readable name via the lookup map. */
function resolveName(row: EngagementRow, names: Record<string, string>): string {
  const key = `${row.contentType}:${row.contentSlug}`;
  return names[key] || row.contentSlug;
}

function detectHiddenGem(row: EngagementRow, medians: MedianValues, name: string): InsightCard | null {
  const highDuration = row.avgVisitDuration > medians.avgVisitDuration * 1.5;
  const lowViews = row.totalPageviews < medians.totalPageviews;
  if (!highDuration || !lowViews) return null;

  const duration = formatDuration(row.avgVisitDuration);
  return {
    type: 'hidden-gem',
    severity: 'positive',
    title: 'Hidden gem',
    name,
    body: `Gets fewer views than average but visitors spend ${duration} per visit. The content is engaging, it just needs more visibility.`,
    contentType: row.contentType,
    contentSlug: row.contentSlug,
    metrics: {
      'Page views': row.totalPageviews,
      'Avg duration': duration,
      'Wall time': formatHours(row.wallTimeHours),
      'Stars': row.stars,
    },
  };
}

function detectNeedsWork(row: EngagementRow, medians: MedianValues, name: string): InsightCard | null {
  const highViews = row.totalPageviews > medians.totalPageviews;
  const lowDuration = row.avgVisitDuration < medians.avgVisitDuration * 0.7;
  const highBounce = row.avgBounceRate > medians.avgBounceRate * 1.3;
  const lowStars = row.stars < medians.stars;

  if (!highViews || (!lowDuration && !highBounce) || !lowStars) return null;

  const avgDuration = formatDuration(row.avgVisitDuration);
  return {
    type: 'needs-work',
    severity: 'warning',
    title: 'Needs work',
    name,
    body: `${row.totalPageviews} views but only ${avgDuration} avg visit and ${Math.round(row.avgBounceRate)}% bounce rate. People land and leave — the page may need better photos or a clearer description.`,
    contentType: row.contentType,
    contentSlug: row.contentSlug,
    metrics: {
      'Page views': row.totalPageviews,
      'Avg duration': avgDuration,
      'Bounce rate': `${Math.round(row.avgBounceRate)}%`,
      'Wall time': formatHours(row.wallTimeHours),
      'Stars': row.stars,
    },
  };
}

function detectStrongPerformer(row: EngagementRow, rows: EngagementRow[], name: string): InsightCard | null {
  // Top 10% by engagement score
  const sorted = [...rows].sort((a, b) => a.engagementScore - b.engagementScore);
  const threshold = sorted[Math.floor(sorted.length * 0.9)]?.engagementScore ?? Infinity;
  if (row.engagementScore < threshold) return null;

  return {
    type: 'strong-performer',
    severity: 'positive',
    title: 'Strong performer',
    name,
    body: `Top 10% by engagement score. Wall time, map conversion, stars, and video plays all signal high interest.`,
    contentType: row.contentType,
    contentSlug: row.contentSlug,
    metrics: {
      'Engagement': Math.round(row.engagementScore * 100),
      'Page views': row.totalPageviews,
      'Wall time': formatHours(row.wallTimeHours),
      'Map conversion': `${Math.round(row.mapConversionRate * 100)}%`,
      'Stars': row.stars,
      'Video play rate': `${Math.round(row.videoPlayRate * 100)}%`,
    },
  };
}

function detectVideosWorking(row: EngagementRow, medians: MedianValues, name: string): InsightCard | null {
  if (medians.videoPlayRate === 0) return null;
  if (row.videoPlayRate <= medians.videoPlayRate * 1.5) return null;

  const pct = Math.round(row.videoPlayRate * 100);
  return {
    type: 'videos-working',
    severity: 'positive',
    title: 'Video is working',
    name,
    body: `${pct}% of visitors play the video — well above average. The thumbnail is compelling.`,
    contentType: row.contentType,
    contentSlug: row.contentSlug,
    metrics: {
      'Video play rate': `${pct}%`,
      'Page views': row.totalPageviews,
    },
  };
}

/**
 * Compute insight cards for a set of engagement rows.
 *
 * @param names - Map of "contentType:contentSlug" → human-readable name
 *
 * Priority order (first match wins per content item):
 *   1. hidden-gem
 *   2. needs-work
 *   3. strong-performer
 *   4. videos-working
 */
export function computeInsights(
  rows: EngagementRow[],
  medians: MedianValues,
  names: Record<string, string> = {},
): InsightCard[] {
  const results: InsightCard[] = [];

  for (const row of rows) {
    const name = resolveName(row, names);
    const insight =
      detectHiddenGem(row, medians, name) ??
      detectNeedsWork(row, medians, name) ??
      detectStrongPerformer(row, rows, name) ??
      detectVideosWorking(row, medians, name);

    if (insight) {
      results.push(insight);
    }
  }

  return results;
}
