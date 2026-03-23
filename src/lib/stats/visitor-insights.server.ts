/**
 * Visitor behavior insights from Plausible custom events.
 * Queries: Repeat Visit distribution, Social Visit referrals, entry pages.
 * Results are cached in stats_cache with a 1-hour TTL.
 */
import type { Database } from '../../db';
import { queryPlausible } from '../external/plausible-api.server';
import { readStatsCache, writeStatsCache } from './cache.server';

export interface VisitorInsights {
  /** Distribution of repeat visit counts: { "2": 150, "3": 80, "5+": 30 } */
  repeatVisits: Record<string, number>;
  /** Total unique returning visitors (visited 2+ days) */
  returningVisitors: number;
  /** Percentage of visitors who return */
  returnRate: number;
  /** Average return count among returning visitors */
  avgReturns: number;
  /** Social referral sources: { "facebook": 40, "reddit": 12 } */
  socialReferrals: Record<string, number>;
  /** Top entry pages: [{ path: "/routes/britannia", visitors: 200 }, ...] */
  entryPages: Array<{ path: string; visitors: number }>;
}

interface QueryOpts {
  apiKey: string;
  siteId: string;
  city: string;
}

/**
 * Get visitor behavior insights for a date range.
 * Reads from cache if fresh, otherwise queries Plausible and caches.
 */
export async function getVisitorInsights(
  db: Database,
  opts: QueryOpts,
  dateRange: string | [string, string],
): Promise<VisitorInsights> {
  const rangeKey = typeof dateRange === 'string' ? dateRange : `${dateRange[0]}_${dateRange[1]}`;
  const cacheKey = `visitor_insights:${rangeKey}`;

  const cached = await readStatsCache(db, opts.city, cacheKey);
  if (cached) return cached as unknown as VisitorInsights;

  // Fire all three Plausible queries in parallel
  const [repeatRows, socialRows, entryRows] = await Promise.all([
    // Repeat Visit custom event — breakdown by totalVisits property
    queryPlausible(opts.apiKey, {
      siteId: opts.siteId,
      metrics: ['visitors'],
      dateRange,
      dimensions: ['event:props:totalVisits'],
      filters: [['is', 'event:goal', ['Repeat Visit']]],
      pagination: { limit: 100 },
    }).catch(() => []),

    // Social Visit custom event — breakdown by network
    queryPlausible(opts.apiKey, {
      siteId: opts.siteId,
      metrics: ['visitors'],
      dateRange,
      dimensions: ['event:props:network'],
      filters: [['is', 'event:goal', ['Social Visit']]],
    }).catch(() => []),

    // Entry pages — standard pageview query with entry_page dimension
    queryPlausible(opts.apiKey, {
      siteId: opts.siteId,
      metrics: ['visitors'],
      dateRange,
      dimensions: ['visit:entry_page'],
      pagination: { limit: 20 },
    }).catch(() => []),
  ]);

  // Process repeat visits into buckets
  const repeatVisits: Record<string, number> = {};
  let totalReturning = 0;
  let totalReturnCount = 0;

  for (const row of repeatRows) {
    const count = parseInt(row.dimensions[0], 10);
    const visitors = row.metrics[0];
    if (isNaN(count)) continue;

    // Bucket: 2, 3, 4, 5+
    const bucket = count >= 5 ? '5+' : String(count);
    repeatVisits[bucket] = (repeatVisits[bucket] || 0) + visitors;
    totalReturning += visitors;
    totalReturnCount += visitors * count;
  }

  // Process social referrals
  const socialReferrals: Record<string, number> = {};
  for (const row of socialRows) {
    socialReferrals[row.dimensions[0]] = row.metrics[0];
  }

  // Process entry pages
  const entryPages = entryRows
    .map(row => ({ path: row.dimensions[0], visitors: row.metrics[0] }))
    .filter(e => e.path !== '/' && !e.path.startsWith('/admin'));

  const result: VisitorInsights = {
    repeatVisits,
    returningVisitors: totalReturning,
    returnRate: 0, // We'd need total unique visitors to compute this — approximate from entry pages
    avgReturns: totalReturning > 0 ? Math.round((totalReturnCount / totalReturning) * 10) / 10 : 0,
    socialReferrals,
    entryPages: entryPages.slice(0, 15),
  };

  // Cache for 1 hour
  await writeStatsCache(db, opts.city, cacheKey, result as unknown as Record<string, unknown>).catch(() => {});

  return result;
}
