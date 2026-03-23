/** Content identity resolved from a URL path. */
export interface ContentIdentity {
  contentType: 'route' | 'event' | 'organizer';
  contentSlug: string;
  pageType: string; // 'detail', 'map', 'map:winter', etc.
}

/** Time range options for the dashboard. */
export type TimeRange = '30d' | '3mo' | '1yr' | 'all';

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
  contentType: 'route' | 'event' | 'organizer';
  contentSlug: string;
  name: string;
  thumbKey?: string;
  primaryValue: number;
  primaryLabel: string;
  secondaryValue?: number;
  secondaryLabel?: string;
}

/** Auto-generated insight card. */
export interface InsightCard {
  type: 'hidden-gem' | 'needs-work' | 'trending' | 'declining' | 'strong-performer' | 'seasonal' | 'videos-working' | 'underused-variant';
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
  pageviews: 'How many times people loaded this page. Each visit counts, even if the same person comes back. Higher means more reach.',
  visitorDays: 'One person visiting on one day equals one visitor-day. If 10 people visit Monday and 8 return Tuesday, that\'s 18 visitor-days. Higher means more people spending more days on the site.',
  wallTime: 'Total hours people spent reading this page — page views multiplied by average time per visit. A page with 100 views at 5 minutes = 8 hours of attention. Higher means the content is holding people\'s interest.',
  stars: 'How many people bookmarked or starred this content. A deliberate action — people only star things they plan to come back to.',
  avgTimeOnPage: 'How long a typical visit lasts. Longer usually means the content is engaging. Compare to site average to know if this page is above or below normal.',
  bounceRate: 'Percentage of visitors who left without clicking anything else. Lower is usually better — it means people explored further. But for some pages (events with all info visible), a high bounce rate is normal.',
  mapConversion: 'What percentage of route page visitors also opened the map. Higher means people are seriously considering riding this route, not just browsing.',
  videoPlayRate: 'What percentage of visitors played a video on this page. Higher means the video thumbnail is compelling and the content invites watching.',
  engagementScore: 'A combined score (0–100) based on wall time, map conversion, stars, and video plays. Compares this content to everything else of the same type. Higher means this content performs well across multiple signals.',
  activeDaysPerUser: 'How many different days a registered user has interacted (starred something). If the average is 1, most people sign up and never return. Higher means people keep coming back.',
  newAccounts: 'Registered users who created a passkey or email login. Does not count anonymous guest accounts (those are created automatically when someone stars something without signing up).',
};
