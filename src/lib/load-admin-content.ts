import { db as getDb } from './get-db';
import { contentEdits } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import type { AdminRoute, AdminEvent } from '../types/admin';
import { routeDetailFromCache } from './models/route-model';
import { eventDetailFromCache } from './models/event-model';

export interface AdminContentResult<T> {
  data: T | null;
}

/**
 * Two-tier data loading for admin detail pages:
 * 1. D1 content_edits cache (with optional validated parsing)
 * 2. Build-time virtual module data
 */
export async function loadAdminContent<T>(opts: {
  contentType: string;
  contentSlug: string;
  virtualModuleData: Record<string, T>;
  fromCache?: (blob: string) => T;
}): Promise<AdminContentResult<T>> {
  const database = getDb();
  let data: T | null = null;

  // Tier 1: D1 cache
  const cached = await database.select().from(contentEdits)
    .where(and(
      eq(contentEdits.contentType, opts.contentType),
      eq(contentEdits.contentSlug, opts.contentSlug),
    ))
    .get();

  if (cached) {
    if (opts.fromCache) {
      try {
        data = opts.fromCache(cached.data);
      } catch {
        console.warn(`Invalid cache for ${opts.contentType}/${opts.contentSlug}, falling back to virtual module`);
        data = null;
      }
    } else {
      data = JSON.parse(cached.data) as T;
    }
  }

  // Tier 2: Virtual module fallback
  if (!data) {
    data = opts.virtualModuleData[opts.contentSlug] ?? null;
  }

  return { data };
}

/**
 * Load admin route list with D1 cache overlay.
 * Merges cached edits over build-time virtual module data and appends
 * routes that only exist in the cache (created since last deploy).
 */
export async function loadAdminRouteList(buildTimeRoutes: AdminRoute[]): Promise<{
  routes: AdminRoute[];
  pendingSlugs: Set<string>;
}> {
  const database = getDb();
  const cachedEdits = await database.select().from(contentEdits)
    .where(eq(contentEdits.contentType, 'routes')).all();

  const cacheMap = new Map(cachedEdits.flatMap(e => {
    try {
      return [[e.contentSlug, routeDetailFromCache(e.data)] as const];
    } catch {
      return [];
    }
  }));

  const routes = buildTimeRoutes.map(r => {
    const cached = cacheMap.get(r.slug);
    if (!cached) return r;
    return {
      ...r,
      name: cached.name ?? r.name,
      mediaCount: cached.media?.length ?? r.mediaCount,
      status: cached.status ?? r.status,
    };
  });

  // Append D1-only routes (created since last deploy)
  const existingSlugs = new Set(buildTimeRoutes.map(r => r.slug));
  for (const [slug, cached] of cacheMap) {
    if (!existingSlugs.has(slug)) {
      routes.push({
        slug,
        name: cached.name || slug,
        mediaCount: cached.media?.length ?? 0,
        status: cached.status || 'draft',
        contentHash: '',
        difficultyScore: null,
      });
    }
  }

  return { routes, pendingSlugs: new Set(cacheMap.keys()) };
}

/**
 * Load admin event list with D1 cache overlay.
 * Merges cached edits over build-time virtual module data and appends
 * events that only exist in the cache (created since last deploy).
 */
export async function loadAdminEventList(buildTimeEvents: AdminEvent[]): Promise<{
  events: AdminEvent[];
  pendingIds: Set<string>;
}> {
  const database = getDb();
  const cachedEdits = await database.select().from(contentEdits)
    .where(eq(contentEdits.contentType, 'events')).all();

  const cacheMap = new Map(cachedEdits.flatMap(e => {
    try {
      return [[e.contentSlug, eventDetailFromCache(e.data)] as const];
    } catch {
      return [];
    }
  }));

  const events = buildTimeEvents.map(e => {
    const cached = cacheMap.get(e.id);
    if (!cached) return e;
    return { ...e, name: cached.name ?? e.name, start_date: cached.start_date ?? e.start_date };
  });

  // Append D1-only events (created since last deploy)
  const existingIds = new Set(buildTimeEvents.map(e => e.id));
  for (const [id, cached] of cacheMap) {
    if (!existingIds.has(id)) {
      const [year, slug] = id.split('/');
      events.push({
        id,
        slug: slug || id,
        year: year || '',
        name: cached.name || id,
        start_date: cached.start_date || '',
        end_date: cached.end_date,
        organizer: cached.organizer,
        poster_key: cached.poster_key,
        contentHash: '',
      });
    }
  }

  return { events, pendingIds: new Set(cacheMap.keys()) };
}

/**
 * Load parked photos with D1 cache overlay.
 * D1 stores the latest parked-photos list after each save, so edits
 * made since the last deploy are visible without rebuilding.
 */
export async function loadParkedPhotosWithOverlay<T>(buildTimeParked: T[]): Promise<T[]> {
  const database = getDb();
  const cached = await database.select().from(contentEdits)
    .where(and(
      eq(contentEdits.contentType, 'parked-photos'),
      eq(contentEdits.contentSlug, '__global'),
    ))
    .get();

  if (cached) {
    try {
      return JSON.parse(cached.data) as T[];
    } catch {
      return buildTimeParked;
    }
  }
  return buildTimeParked;
}
