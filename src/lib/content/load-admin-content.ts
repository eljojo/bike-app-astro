import { db as getDb } from '../get-db';
import { contentEdits } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import type { AdminRoute, AdminEvent } from '../../types/admin';
import type { AdminRide } from '../../loaders/admin-rides';
import { routeDetailFromCache } from '../models/route-model';
import { eventDetailFromCache } from '../models/event-model';
import { rideDetailFromCache } from '../models/ride-model';
import { deserializeSharedKeys, type SharedKeysMap } from '../media/photo-registry';
import { CITY } from '../config/config';

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
      eq(contentEdits.city, CITY),
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
 * Convenience wrapper for admin detail pages.
 * Handles null ID check, loadAdminContent call, and null data check in one step.
 */
export async function loadDetailPageData<T>(opts: {
  contentType: string;
  id: string | undefined;
  virtualModuleData: Record<string, T>;
  fromCache: (blob: string) => T;
}): Promise<{ data: T; notFound: false } | { notFound: true }> {
  if (!opts.id) return { notFound: true };
  const { data } = await loadAdminContent({
    contentType: opts.contentType,
    contentSlug: opts.id,
    virtualModuleData: opts.virtualModuleData,
    fromCache: opts.fromCache,
  });
  if (!data) return { notFound: true };
  return { data, notFound: false };
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
    .where(and(eq(contentEdits.city, CITY), eq(contentEdits.contentType, 'routes'))).all();

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
    const cachedCover = cached.media?.find(m => m.cover) || cached.media?.[0];
    return {
      ...r,
      name: cached.name ?? r.name,
      mediaCount: cached.media?.length ?? r.mediaCount,
      status: cached.status ?? r.status,
      coverKey: cachedCover?.key ?? r.coverKey,
    };
  });

  // Append D1-only routes (created since last deploy)
  const existingSlugs = new Set(buildTimeRoutes.map(r => r.slug));
  for (const [slug, cached] of cacheMap) {
    if (!existingSlugs.has(slug)) {
      const newCover = cached.media?.find(m => m.cover) || cached.media?.[0];
      routes.push({
        slug,
        name: cached.name || slug,
        mediaCount: cached.media?.length ?? 0,
        status: cached.status || 'draft',
        contentHash: '',
        difficultyScore: null,
        coverKey: newCover?.key,
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
    .where(and(eq(contentEdits.city, CITY), eq(contentEdits.contentType, 'events'))).all();

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
    return {
      ...e,
      name: cached.name ?? e.name,
      start_date: cached.start_date ?? e.start_date,
      status: cached.status ?? e.status,
      routes: cached.routes ?? e.routes,
      mediaCount: cached.media?.length ?? e.mediaCount,
      waypointCount: cached.waypoints?.length ?? e.waypointCount,
    };
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
        status: cached.status,
        routes: cached.routes,
        organizer: cached.organizer,
        poster_key: cached.poster_key,
        mediaCount: cached.media?.length ?? 0,
        waypointCount: cached.waypoints?.length ?? 0,
        contentHash: '',
      });
    }
  }

  return { events, pendingIds: new Set(cacheMap.keys()) };
}

/**
 * Load shared-keys map with D1 cache overlay.
 * D1 stores the latest shared-keys map after each save, so mutations
 * made since the last deploy are visible without rebuilding.
 */
export async function loadSharedKeysMap(
  buildTimeData: Record<string, Array<{ type: string; slug: string }>>,
): Promise<SharedKeysMap> {
  const database = getDb();
  const cached = await database.select().from(contentEdits)
    .where(and(
      eq(contentEdits.city, CITY),
      eq(contentEdits.contentType, 'photo-shared-keys'),
      eq(contentEdits.contentSlug, '__global'),
    ))
    .get();

  if (cached) {
    try {
      return deserializeSharedKeys(cached.data);
    } catch {
      // Fall through to build-time data
    }
  }

  return new Map(
    Object.entries(buildTimeData).map(([key, usages]) => [
      key,
      usages as Array<{ type: 'route' | 'place' | 'event' | 'parked'; slug: string }>,
    ]),
  );
}

/**
 * Load admin ride list with D1 cache overlay.
 * Merges cached edits over build-time virtual module data and appends
 * rides that only exist in the cache (created since last deploy).
 */
export async function loadAdminRideList(buildTimeRides: AdminRide[]): Promise<{
  rides: AdminRide[];
  pendingSlugs: Set<string>;
}> {
  const database = getDb();
  const cachedEdits = await database.select().from(contentEdits)
    .where(and(eq(contentEdits.city, CITY), eq(contentEdits.contentType, 'rides'))).all();

  const cacheMap = new Map(cachedEdits.flatMap(e => {
    try {
      return [[e.contentSlug, rideDetailFromCache(e.data)] as const];
    } catch {
      return [];
    }
  }));

  const rides = buildTimeRides.map(r => {
    const cached = cacheMap.get(r.slug);
    if (!cached) return r;
    return {
      ...r,
      name: cached.name ?? r.name,
      date: cached.ride_date ?? r.date,
      country: cached.country ?? r.country,
      highlight: cached.highlight ?? r.highlight,
    };
  });

  // Append D1-only rides (created since last deploy)
  const existingSlugs = new Set(buildTimeRides.map(r => r.slug));
  for (const [slug, cached] of cacheMap) {
    if (!existingSlugs.has(slug) && cached) {
      rides.push({
        slug,
        name: cached.name || slug,
        date: cached.ride_date || '',
        distance_km: 0,
        elevation_m: 0,
        country: cached.country,
        highlight: cached.highlight,
        contentHash: '',
      });
    }
  }

  return { rides, pendingSlugs: new Set(cacheMap.keys()) };
}

export async function loadParkedPhotosWithOverlay<T>(buildTimeParked: T[]): Promise<T[]> {
  const database = getDb();
  const cached = await database.select().from(contentEdits)
    .where(and(
      eq(contentEdits.city, CITY),
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
