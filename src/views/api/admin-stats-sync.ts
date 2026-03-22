import type { APIContext } from 'astro';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { getInstanceFeatures } from '../../lib/config/instance-features';
import { db } from '../../lib/get-db';
import { env } from '../../lib/env/env.service';
import { CITY } from '../../lib/config/config';
import { getCityConfig } from '../../lib/config/city-config';
import { queryPlausible } from '../../lib/external/plausible-api.server';
import { processPlausibleData, processDailyAggregate, upsertContentRows, upsertDailyRows } from '../../lib/stats/sync.server';
import { rebuildEngagement } from '../../lib/stats/engagement.server';
import { siteDailyMetrics } from '../../db/schema';
import { eq, desc } from 'drizzle-orm';

export const prerender = false;

export async function POST({ locals, url }: APIContext) {
  if (!getInstanceFeatures().hasRoutes) {
    return new Response(null, { status: 404 });
  }

  const user = authorize(locals, 'sync-stats');
  if (user instanceof Response) return user;

  const apiKey = env.PLAUSIBLE_API_KEY;
  if (!apiKey) {
    return jsonError('Plausible sync requires PLAUSIBLE_API_KEY — not available in local development', 400);
  }

  const cityConfig = getCityConfig();
  const siteId = cityConfig.plausible_domain;
  const locales = cityConfig.locales ?? [cityConfig.locale];
  const defaultLoc = cityConfig.locale;
  const database = db();
  const fullSync = url.searchParams.get('full') === 'true';

  try {
    // Determine date range
    let fromDate: string;
    if (fullSync) {
      fromDate = '2020-01-01'; // far enough back to capture all data
    } else {
      // Find the most recent synced date
      const lastRow = await database.select({ date: siteDailyMetrics.date })
        .from(siteDailyMetrics)
        .where(eq(siteDailyMetrics.city, CITY))
        .orderBy(desc(siteDailyMetrics.date))
        .limit(1);
      fromDate = lastRow.length > 0 ? lastRow[0].date : '2020-01-01';
    }

    const today = new Date().toISOString().split('T')[0];

    // 1. Fetch page breakdown from Plausible
    const pageRows = await queryPlausible(apiKey, {
      siteId,
      metrics: ['visitors', 'pageviews', 'visit_duration', 'bounce_rate'],
      dateRange: [fromDate, today],
      dimensions: ['event:page'],
      pagination: { limit: 10000 },
    });

    // 2. Process through URL resolver
    const { contentRows, skippedPaths } = processPlausibleData(
      pageRows, CITY, {}, {}, today, locales, defaultLoc,
    );

    // 3. Upsert content metrics
    if (contentRows.length > 0) {
      await upsertContentRows(database, contentRows);
    }

    // 4. Fetch daily aggregates
    const dailyRows = await queryPlausible(apiKey, {
      siteId,
      metrics: ['visitors', 'pageviews', 'visit_duration', 'bounce_rate'],
      dateRange: [fromDate, today],
      dimensions: ['time:day'],
    });

    // 5. Process and upsert daily metrics
    const dailyMetrics = processDailyAggregate(dailyRows, CITY);
    if (dailyMetrics.length > 0) {
      await upsertDailyRows(database, dailyMetrics);
    }

    // 6. Rebuild engagement scores
    await rebuildEngagement(database, CITY);

    return jsonResponse({
      success: true,
      contentPages: contentRows.length,
      skippedPaths: skippedPaths.length,
      dailyRows: dailyMetrics.length,
    } as Record<string, unknown>);
  } catch (err: unknown) {
    console.error('stats sync error:', err);
    const message = err instanceof Error ? err.message : 'Failed to sync';
    return jsonError(message, 500);
  }
}
