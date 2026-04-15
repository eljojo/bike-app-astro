/** Content identity resolved from a URL path. */
export interface ContentIdentity {
  contentType: 'route' | 'event' | 'organizer' | 'bike-path';
  contentSlug: string;
  pageType: string; // 'detail', 'map', 'map:winter', etc.
}

/** Time range options for the dashboard. */
export type TimeRange = '30d' | '3mo' | '1yr' | 'all';

export const VALID_RANGES: readonly TimeRange[] = ['30d', '3mo', '1yr', 'all'] as const;

/** Parse and validate a time range string. Returns null if invalid. */
export function parseTimeRange(value: string | null): TimeRange | null {
  const v = value || '30d';
  return (VALID_RANGES as readonly string[]).includes(v) ? (v as TimeRange) : null;
}

/** Granularity adapts to the time range. */
export type Granularity = 'day' | 'week' | 'month';

export function granularityForRange(range: TimeRange): Granularity {
  switch (range) {
    case '30d': return 'day';
    case '3mo': return 'week';
    case '1yr': case 'all': return 'month';
  }
}

/** A single time-series data point. */
export interface TimeSeriesPoint {
  date: string;
  value: number;
  secondaryValue?: number;
}

/**
 * Time-series builders — centralized projections from daily aggregate rows
 * into TimeSeriesPoint[]. Each builder encapsulates the metric math and the
 * output shape. Generic input types keep these decoupled from any specific
 * row schema — callers just supply the fields each builder reads.
 */

/** Pageviews as primary value, visitors as secondary. Coalesces missing
 *  visitors to 0 so charts render a bar rather than a gap. */
export function buildPageviewsSeries<
  D extends { date: string; pageviews: number; visitors?: number | null },
>(daily: D[]): TimeSeriesPoint[] {
  return daily.map(d => ({
    date: d.date,
    value: d.pageviews,
    secondaryValue: d.visitors ?? 0,
  }));
}

/** Average visit duration (seconds), rounded. Reads from an `avgDuration` field. */
export function buildAvgDurationSeries<
  D extends { date: string; avgDuration?: number | null },
>(daily: D[]): TimeSeriesPoint[] {
  return daily.map(d => ({
    date: d.date,
    value: Math.round(d.avgDuration ?? 0),
  }));
}

/** Total visit duration (seconds), rounded. Reads from a `totalDurationS` field. */
export function buildTotalDurationSeries<
  D extends { date: string; totalDurationS: number },
>(daily: D[]): TimeSeriesPoint[] {
  return daily.map(d => ({
    date: d.date,
    value: Math.round(d.totalDurationS),
  }));
}

/** Pages-per-visit ratio (pageviews / visitors), rounded to 1dp. Returns 0 when
 *  visitors is 0 to avoid division-by-zero NaN in charts. */
export function buildPagesPerVisitSeries<
  D extends { date: string; pageviews: number; visitors: number },
>(daily: D[]): TimeSeriesPoint[] {
  return daily.map(d => ({
    date: d.date,
    value: d.visitors > 0 ? Math.round((d.pageviews / d.visitors) * 10) / 10 : 0,
  }));
}

/** Summary card data for the dashboard. */
export interface SummaryCard {
  label: string;
  value: number | string;
  unit?: string;
  change?: number;
  description: string;
}

/** Leaderboard entry. */
export interface LeaderboardEntry {
  contentType: 'route' | 'event' | 'organizer' | 'bike-path';
  contentSlug: string;
  name: string;
  thumbKey?: string;
  primaryValue: number;
  primaryLabel: string;
  secondaryValue?: number | string;
  secondaryLabel?: string;
}

/** Engagement leaderboard entry — adds per-row breakdown of the engagement score. */
export interface EngagementLeaderboardEntry extends LeaderboardEntry {
  breakdown: {
    wallTime: string;
    mapConversion: string;
    stars: number;
    videoPlayRate: string;
  };
}

/** Minimal row contract for the views leaderboard. */
export interface ViewsLeaderboardRow {
  contentType: string;
  contentSlug: string;
  totalPageviews: number;
  wallTimeHours: number;
}

/** Engagement-specific row with the extra metrics the breakdown reads.
 *  Named to avoid collision with insights.ts EngagementRow (different shape). */
export interface EngagementLeaderboardRow extends ViewsLeaderboardRow {
  engagementScore: number;
  mapConversionRate: number;
  stars: number;
  videoPlayRate: number;
}

/** Name + thumbnail lookups passed into the leaderboard builders. */
export interface LeaderboardLookups {
  names: Record<string, string>;
  thumbs: Record<string, string>;
}

function lookupKey(row: { contentType: string; contentSlug: string }): string {
  return `${row.contentType}:${row.contentSlug}`;
}

/** Views leaderboard builder: page views + wall time per row. */
export function toViewsLeaderboardEntry(
  row: ViewsLeaderboardRow,
  lookups: LeaderboardLookups,
): LeaderboardEntry {
  const key = lookupKey(row);
  return {
    contentType: row.contentType as LeaderboardEntry['contentType'],
    contentSlug: row.contentSlug,
    name: lookups.names[key] || row.contentSlug,
    thumbKey: lookups.thumbs[key],
    primaryValue: row.totalPageviews,
    primaryLabel: 'views',
    secondaryValue: formatDuration(row.wallTimeHours * 3600),
    secondaryLabel: 'time',
  };
}

/** Engagement leaderboard builder: engagement score + breakdown. */
export function toEngagementLeaderboardEntry(
  row: EngagementLeaderboardRow,
  lookups: LeaderboardLookups,
): EngagementLeaderboardEntry {
  const key = lookupKey(row);
  return {
    contentType: row.contentType as LeaderboardEntry['contentType'],
    contentSlug: row.contentSlug,
    name: lookups.names[key] || row.contentSlug,
    thumbKey: lookups.thumbs[key],
    primaryValue: Math.round(row.engagementScore * 100),
    primaryLabel: 'score',
    secondaryValue: row.totalPageviews,
    secondaryLabel: 'views',
    breakdown: {
      wallTime: formatDuration(row.wallTimeHours * 3600),
      mapConversion: `${Math.round(row.mapConversionRate * 100)}%`,
      stars: row.stars,
      videoPlayRate: `${Math.round(row.videoPlayRate * 100)}%`,
    },
  };
}

/** Auto-generated insight card. */
export interface InsightCard {
  type: 'hidden-gem' | 'needs-work' | 'trending' | 'declining' | 'strong-performer' | 'seasonal' | 'videos-working' | 'underused-variant' | 'low-bounce';
  severity: 'positive' | 'warning' | 'neutral';
  title: string;
  name: string;
  body: string;
  contentType?: string;
  contentSlug?: string;
  thumbKey?: string;
  /** Key metrics for this content item — shown on hover or in drill-down. */
  metrics?: Record<string, string | number>;
}

/** Chart data passed from server to Preact island. */
export interface ChartDataset {
  label: string;
  data: number[];
  color?: string;
  type?: 'bar' | 'line';
}

export interface ChartData {
  labels: string[];
  datasets: ChartDataset[];
  title: string;
  description: string;
}

/** Compute the start date for a given time range relative to `now`. */
export function getStartDate(now: Date, range: TimeRange): Date {
  const d = new Date(now);
  switch (range) {
    case '30d': d.setDate(d.getDate() - 30); break;
    case '3mo': d.setMonth(d.getMonth() - 3); break;
    case '1yr': d.setFullYear(d.getFullYear() - 1); break;
    case 'all': d.setFullYear(2020); break;
  }
  return d;
}

/** Format seconds as a compact duration string (e.g. "2m 30s", "5m", "1h 15m"). */
export function formatDuration(seconds: number): string {
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/** Format a 0–1 rate as a human-readable fraction (e.g. "1 in 3", "Half the"). */
export function humanFraction(rate: number): string {
  if (rate >= 0.92) return 'Almost all';
  if (rate >= 0.72) return '3 in 4';
  if (rate >= 0.6) return '2 in 3';
  if (rate >= 0.45) return 'Half the';
  if (rate >= 0.3) return '1 in 3';
  if (rate >= 0.22) return '1 in 4';
  if (rate >= 0.17) return '1 in 5';
  if (rate >= 0.08) return '1 in 10';
  return `${Math.round(rate * 100)}% of`;
}

/** Funnel step for route drill-down. */
export interface FunnelStep {
  label: string;
  count: number;
  rate?: number;
  siteAvgRate?: number;
}

/** Metric descriptions — shown in the UI next to each metric.
 * Every metric the user sees must have an entry here. */
export const METRIC_DESCRIPTIONS: Record<string, string> = {
  pageviews: 'How many times people loaded this page. Each visit counts, even if the same person comes back.',
  visitorDays: 'One person visiting on one day equals one visitor-day. If 10 people visit Monday and 8 return Tuesday, that\'s 18 visitor-days.',
  wallTime: 'Total hours people spent on this page. Computed from Plausible\'s visit duration data.',
  stars: 'How many people bookmarked or starred this content.',
  avgTimeOnPage: 'How long a typical visit lasts. Total time on page divided by number of visits.',
  bounceRate: 'Percentage of visitors who left without clicking anything else. For some pages (events with all info visible), a high bounce rate is normal.',
  mapConversion: 'What percentage of route page visitors also opened the map.',
  videoPlayRate: 'What percentage of visitors played a video on this page.',
  engagementScore: 'A combined score (0–100) based on wall time, map conversion, stars, and video plays. Compared within the same content type using percentile ranking.',
  activeDaysPerUser: 'How many different days a registered user has interacted (starred something).',
  newAccounts: 'Registered users who created a passkey or email login. Does not count guest accounts.',
};
