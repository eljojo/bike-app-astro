import type { APIContext } from 'astro';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { db } from '../../lib/get-db';
import { CITY } from '../../lib/config/config';
import {
  querySidebarMostViewed, querySidebarMostStarred, querySidebarTrending,
  querySidebarOverlooked, querySidebarStillVisiting,
  type SidebarData,
} from '../../lib/stats/sidebar-queries.server';

export const prerender = false;

/** Map plural registry names (used in query params) to singular D1 content types. */
const PLURAL_TO_SINGULAR: Record<string, string> = {
  routes: 'route',
  events: 'event',
  organizers: 'organizer',
  'bike-paths': 'bike-path',
};

/** Types that have no stats in D1. */
const NO_STATS_TYPES = new Set(['places', 'rides']);

function emptyResponse(): SidebarData {
  return { mostViewed: [], mostStarred: [], trending: [], overlooked: [], stillVisiting: [] };
}

export async function GET(ctx: APIContext) {
  const user = authorize(ctx.locals, 'view-stats');
  if (user instanceof Response) return user;

  const pluralType = ctx.url.searchParams.get('type');
  if (!pluralType) return jsonError('Missing ?type= parameter', 400);

  // Types without D1 stats get empty arrays
  if (NO_STATS_TYPES.has(pluralType)) {
    return jsonResponse(emptyResponse() as unknown as Record<string, unknown>);
  }

  const contentType = PLURAL_TO_SINGULAR[pluralType];
  if (!contentType) return jsonError(`Unknown type: ${pluralType}`, 400);

  let database: ReturnType<typeof db>;
  try {
    database = db();
  } catch {
    // Local dev without D1 — return empty
    return jsonResponse(emptyResponse() as unknown as Record<string, unknown>);
  }

  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const currentStart = thirtyDaysAgo.toISOString().split('T')[0];
    const currentEnd = now.toISOString().split('T')[0];
    const previousStart = sixtyDaysAgo.toISOString().split('T')[0];
    const previousEnd = currentStart;

    const isEvents = pluralType === 'events';

    const [mostViewed, mostStarred, trending, overlooked, stillVisiting] = await Promise.all([
      querySidebarMostViewed(database, CITY, contentType),
      querySidebarMostStarred(database, CITY, contentType),
      querySidebarTrending(database, CITY, contentType, currentStart, currentEnd, previousStart, previousEnd),
      querySidebarOverlooked(database, CITY, contentType),
      isEvents
        ? querySidebarStillVisiting(database, CITY, currentStart, currentEnd)
        : Promise.resolve([]),
    ]);

    const data: SidebarData = { mostViewed, mostStarred, trending, overlooked, stillVisiting };
    return jsonResponse(data as unknown as Record<string, unknown>);
  } catch (err: unknown) {
    console.error('sidebar stats error:', err);
    const message = err instanceof Error ? err.message : 'Failed to load sidebar stats';
    return jsonError(message, 500);
  }
}
