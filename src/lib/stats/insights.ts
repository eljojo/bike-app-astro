import type { InsightCard } from './types';
import { formatDuration } from './types';

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
  // Optional period comparison (for trending/declining detection)
  currentPeriodPageviews?: number;
  previousPeriodPageviews?: number;
  // Optional monthly distribution (for seasonal detection)
  monthlyPageviews?: number[];
  // Optional variant breakdown (for underused-variant detection)
  variantViews?: Record<string, number>;
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

function formatHours(h: number): string {
  return formatDuration(h * 3600);
}

/** Resolve a content slug to a human-readable name via the lookup map. */
function resolveName(row: EngagementRow, names: Record<string, string>): string {
  const key = `${row.contentType}:${row.contentSlug}`;
  return names[key] || row.contentSlug;
}

function detectHiddenGem(row: EngagementRow, medians: MedianValues, name: string): InsightCard | null {
  // Need at least 10 views and 30s avg duration to be a meaningful hidden gem
  if (row.totalPageviews < 10 || row.avgVisitDuration < 30) return null;
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
  // Top 10% by engagement score, need meaningful data
  if (row.totalPageviews < 10) return null;
  const sorted = [...rows].sort((a, b) => a.engagementScore - b.engagementScore);
  const threshold = sorted[Math.floor(sorted.length * 0.9)]?.engagementScore ?? Infinity;
  if (row.engagementScore < threshold) return null;

  // Build a human-readable narrative of what makes it strong
  const signals: string[] = [];
  if (row.wallTimeHours > 1) signals.push(`${formatHours(row.wallTimeHours)} of reading time`);
  if (row.mapConversionRate > 0.1) signals.push(`${Math.round(row.mapConversionRate * 100)}% open the map`);
  if (row.stars > 0) signals.push(`${row.stars} star${row.stars > 1 ? 's' : ''}`);
  if (row.videoPlayRate > 0.05) signals.push(`${Math.round(row.videoPlayRate * 100)}% play the video`);
  const narrative = signals.length > 0
    ? signals.join(', ') + '.'
    : 'Performs well across engagement signals.';

  return {
    type: 'strong-performer',
    severity: 'positive',
    title: 'Strong performer',
    name,
    body: `Top 10% by engagement. ${narrative}`,
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
    body: `${pct}% of visitors play the video — well above average.`,
    contentType: row.contentType,
    contentSlug: row.contentSlug,
    metrics: {
      'Video play rate': `${pct}%`,
      'Page views': row.totalPageviews,
    },
  };
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function detectTrending(row: EngagementRow, name: string): InsightCard | null {
  const curr = row.currentPeriodPageviews;
  const prev = row.previousPeriodPageviews;
  if (curr == null || prev == null) return null;
  if (curr < 20 || prev < 20) return null;
  const ratio = curr / prev;
  if (ratio <= 1.3) return null;

  const pctChange = Math.round((ratio - 1) * 100);
  return {
    type: 'trending',
    severity: 'positive',
    title: 'Trending up',
    name,
    body: `${pctChange}% more views than the previous period.`,
    contentType: row.contentType,
    contentSlug: row.contentSlug,
    metrics: {
      'Current period': curr,
      'Previous period': prev,
      'Change': `+${pctChange}%`,
    },
  };
}

function detectDeclining(row: EngagementRow, name: string): InsightCard | null {
  const curr = row.currentPeriodPageviews;
  const prev = row.previousPeriodPageviews;
  if (curr == null || prev == null) return null;
  if (curr < 20 || prev < 20) return null;
  const ratio = curr / prev;
  if (ratio >= 0.7) return null;

  const pctChange = Math.round((1 - ratio) * 100);
  return {
    type: 'declining',
    severity: 'warning',
    title: 'Declining',
    name,
    body: `${pctChange}% fewer views than the previous period.`,
    contentType: row.contentType,
    contentSlug: row.contentSlug,
    metrics: {
      'Current period': curr,
      'Previous period': prev,
      'Change': `-${pctChange}%`,
    },
  };
}

function detectSeasonal(row: EngagementRow, name: string): InsightCard | null {
  const monthly = row.monthlyPageviews;
  if (!monthly || monthly.length < 12) return null;

  const nonZero = monthly.filter(v => v > 0);
  if (nonZero.length === 0) return null;

  const maxVal = Math.max(...monthly);
  const minVal = Math.min(...nonZero);
  if (maxVal / minVal <= 3) return null;

  const peakIdx = monthly.indexOf(maxVal);
  const troughIdx = monthly.indexOf(minVal);

  return {
    type: 'seasonal',
    severity: 'neutral',
    title: 'Seasonal pattern',
    name,
    body: `Views peak in ${MONTH_NAMES[peakIdx]} and drop in ${MONTH_NAMES[troughIdx]}.`,
    contentType: row.contentType,
    contentSlug: row.contentSlug,
    metrics: {
      'Peak month': `${MONTH_NAMES[peakIdx]} (${maxVal})`,
      'Trough month': `${MONTH_NAMES[troughIdx]} (${minVal})`,
      'Ratio': `${Math.round(maxVal / minVal)}x`,
    },
  };
}

function detectLowBounce(row: EngagementRow, medians: MedianValues, name: string): InsightCard | null {
  // Need meaningful traffic and a bounce rate well below median
  if (row.totalPageviews < 20) return null;
  if (medians.avgBounceRate === 0) return null;
  if (row.avgBounceRate >= medians.avgBounceRate * 0.5) return null;

  const pct = Math.round(row.avgBounceRate);
  return {
    type: 'low-bounce',
    severity: 'positive',
    title: 'Low bounce rate',
    name,
    body: `Only ${pct}% of visitors leave without interacting — less than half the site average.`,
    contentType: row.contentType,
    contentSlug: row.contentSlug,
    metrics: {
      'Bounce rate': `${pct}%`,
      'Site median': `${Math.round(medians.avgBounceRate)}%`,
      'Page views': row.totalPageviews,
      'Avg duration': formatDuration(row.avgVisitDuration),
    },
  };
}

function detectUnderusedVariant(row: EngagementRow, name: string): InsightCard | null {
  const variants = row.variantViews;
  if (!variants) return null;

  const totalMapViews = Object.values(variants).reduce((sum, v) => sum + v, 0);
  if (totalMapViews < 20) return null;

  for (const [variant, views] of Object.entries(variants)) {
    // Skip the main map — only flag variants
    if (variant === 'map') continue;
    const pct = Math.round((views / totalMapViews) * 100);
    if (views / totalMapViews < 0.1) {
      return {
        type: 'underused-variant',
        severity: 'neutral',
        title: 'Underused variant',
        name,
        body: `The ${variant} map variant gets ${pct}% of map traffic.`,
        contentType: row.contentType,
        contentSlug: row.contentSlug,
        metrics: {
          'Variant': variant,
          'Variant views': views,
          'Total map views': totalMapViews,
          'Share': `${pct}%`,
        },
      };
    }
  }
  return null;
}

/**
 * Compute insight cards for a set of engagement rows.
 *
 * @param names - Map of "contentType:contentSlug" → human-readable name
 *
 * Priority order (first match wins per content item):
 *   1. hidden-gem
 *   2. needs-work
 *   3. trending
 *   4. declining
 *   5. strong-performer
 *   6. low-bounce
 *   7. seasonal
 *   8. videos-working
 *   9. underused-variant
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
      detectTrending(row, name) ??
      detectDeclining(row, name) ??
      detectStrongPerformer(row, rows, name) ??
      detectLowBounce(row, medians, name) ??
      detectSeasonal(row, name) ??
      detectVideosWorking(row, medians, name) ??
      detectUnderusedVariant(row, name);

    if (insight) {
      results.push(insight);
    }
  }

  return results;
}
