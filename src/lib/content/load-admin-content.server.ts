import { db as getDb } from '../get-db';
import { contentEdits } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import type { AdminRoute, AdminEvent } from '../../types/admin';
import type { AdminRide } from '../../loaders/admin-rides';
import { routeDetailFromCache } from '../models/route-model';
import { eventDetailFromCache } from '../models/event-model';
import { rideDetailFromCache } from '../models/ride-model';
import { organizerDetailFromCache } from '../models/organizer-model';
import type { AdminOrganizer } from '../../types/admin';
import { deserializeSharedKeys, type SharedKeysMap } from '../media/media-registry';
import { CITY } from '../config/config';

export interface AdminContentResult<T> {
  data: T | null;
}

/**
 * Config for the generic admin list overlay factory.
 * Each content type provides its own field mappings for overlay and fresh-item creation.
 */
export interface AdminListOverlayConfig<TItem, TCached> {
  contentType: string;
  buildTimeItems: TItem[];
  getId: (item: TItem) => string;
  fromCache: (json: string) => TCached;
  overlay: (item: TItem, cached: TCached) => TItem;
  freshItemFromCache: (id: string, cached: TCached) => TItem;
}

/**
 * Generic admin list overlay: queries D1 cache, overlays cached data onto
 * build-time items, and appends cache-only items created since last deploy.
 */
export async function loadAdminContentList<TItem, TCached>(
  config: AdminListOverlayConfig<TItem, TCached>,
): Promise<{ items: TItem[]; pendingIds: Set<string> }> {
  const database = getDb();
  const cachedEdits = await database.select().from(contentEdits)
    .where(and(eq(contentEdits.city, CITY), eq(contentEdits.contentType, config.contentType))).all();

  const cacheMap = new Map(cachedEdits.flatMap(e => {
    try {
      return [[e.contentSlug, config.fromCache(e.data)] as const];
    } catch {
      return [];
    }
  }));

  const items = config.buildTimeItems.map(item => {
    const cached = cacheMap.get(config.getId(item));
    if (!cached) return item;
    return config.overlay(item, cached);
  });

  // Append cache-only items (created since last deploy)
  const existingIds = new Set(config.buildTimeItems.map(config.getId));
  for (const [id, cached] of cacheMap) {
    if (!existingIds.has(id)) {
      items.push(config.freshItemFromCache(id, cached));
    }
  }

  return { items, pendingIds: new Set(cacheMap.keys()) };
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
  const { items, pendingIds } = await loadAdminContentList({
    contentType: 'routes',
    buildTimeItems: buildTimeRoutes,
    getId: r => r.slug,
    fromCache: routeDetailFromCache,
    overlay: (r, cached) => {
      const cachedCover = cached.media?.find(m => m.cover) || cached.media?.[0];
      return {
        ...r,
        name: cached.name ?? r.name,
        mediaCount: cached.media?.length ?? r.mediaCount,
        status: cached.status ?? r.status,
        coverKey: cachedCover?.key ?? r.coverKey,
      };
    },
    freshItemFromCache: (slug, cached) => {
      const newCover = cached.media?.find(m => m.cover) || cached.media?.[0];
      return {
        slug,
        name: cached.name || slug,
        mediaCount: cached.media?.length ?? 0,
        status: cached.status || 'draft',
        contentHash: '',
        difficultyScore: null,
        coverKey: newCover?.key,
      };
    },
  });
  return { routes: items, pendingSlugs: pendingIds };
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
  const { items, pendingIds } = await loadAdminContentList({
    contentType: 'events',
    buildTimeItems: buildTimeEvents,
    getId: e => e.id,
    fromCache: eventDetailFromCache,
    overlay: (e, cached) => ({
      ...e,
      name: cached.name ?? e.name,
      start_date: cached.start_date ?? e.start_date,
      status: cached.status ?? e.status,
      routes: cached.routes ?? e.routes,
      hasBody: (cached.body?.trim().length ?? 0) > 50,
      mediaCount: cached.media?.length ?? e.mediaCount,
      waypointCount: cached.waypoints?.length ?? e.waypointCount,
    }),
    freshItemFromCache: (id, cached) => {
      const [year, slug] = id.split('/');
      return {
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
        hasBody: (cached.body?.trim().length ?? 0) > 50,
        mediaCount: cached.media?.length ?? 0,
        waypointCount: cached.waypoints?.length ?? 0,
        contentHash: '',
      };
    },
  });
  return { events: items, pendingIds };
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
      eq(contentEdits.contentType, 'media-shared-keys'),
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
  const { items, pendingIds } = await loadAdminContentList({
    contentType: 'rides',
    buildTimeItems: buildTimeRides,
    getId: r => r.slug,
    fromCache: rideDetailFromCache,
    overlay: (r, cached) => ({
      ...r,
      name: cached.name ?? r.name,
      date: cached.ride_date ?? r.date,
      country: cached.country ?? r.country,
      highlight: cached.highlight ?? r.highlight,
    }),
    freshItemFromCache: (slug, cached) => ({
      slug,
      name: cached.name || slug,
      date: cached.ride_date || '',
      distance_km: 0,
      elevation_m: 0,
      country: cached.country,
      highlight: cached.highlight,
      contentHash: '',
    }),
  });
  return { rides: items, pendingSlugs: pendingIds };
}

/**
 * Load admin organizer list with D1 cache overlay.
 * Merges cached edits over build-time virtual module data and appends
 * organizers that only exist in the cache (created since last deploy).
 */
export async function loadAdminOrganizerList(
  buildTimeOrganizers: AdminOrganizer[],
): Promise<{ items: AdminOrganizer[]; pendingIds: Set<string> }> {
  return loadAdminContentList({
    contentType: 'organizers',
    buildTimeItems: buildTimeOrganizers,
    getId: (item) => item.slug,
    fromCache: organizerDetailFromCache,
    overlay: (item, cached) => ({
      ...item,
      name: cached.name,
      tagline: cached.tagline,
      tags: cached.tags,
      featured: cached.featured,
      instagram: cached.instagram,
      photo_key: cached.photo_key,
      photo_content_type: cached.photo_content_type,
      hasBody: (cached.body?.trim().length ?? 0) > 50,
      social_links: cached.social_links?.length ? cached.social_links : undefined,
      contentHash: cached.contentHash ?? item.contentHash,
    }),
    freshItemFromCache: (id, cached) => ({
      slug: id,
      name: cached.name,
      tagline: cached.tagline,
      tags: cached.tags,
      featured: cached.featured,
      website: cached.website,
      instagram: cached.instagram,
      photo_key: cached.photo_key,
      photo_content_type: cached.photo_content_type,
      hasBody: (cached.body?.trim().length ?? 0) > 50,
      social_links: cached.social_links?.length ? cached.social_links : undefined,
      contentHash: cached.contentHash ?? '',
    }),
  });
}

export async function loadParkedMediaWithOverlay<T>(buildTimeParked: T[]): Promise<T[]> {
  const database = getDb();
  const cached = await database.select().from(contentEdits)
    .where(and(
      eq(contentEdits.city, CITY),
      eq(contentEdits.contentType, 'parked-media'),
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

/**
 * Fetch a prerendered JSON file from the app's own static assets.
 * Three execution paths:
 * - Local (disk available): reads from dist/client/ on disk (avoids self-fetch deadlock)
 * - Local (dev server): global fetch() works (Astro dev server handles concurrency)
 * - Cloudflare Workers: uses ASSETS binding (avoids self-fetch deadlock / 522)
 *
 * NOTE: The disk-read vs fetch decision uses a runtime existsSync check, NOT
 * import.meta.env.PROD. Astro's SSR build treats import.meta.env.PROD as falsy
 * in server chunks, so Rollup dead-code-eliminates the readFileSync branch when
 * combined with Vite define constants. See detailed_plan.md § Build-Time Constants.
 */
export async function fetchJson<T>(url: URL): Promise<T> {
  if (__RUNTIME_LOCAL__) {
    const { existsSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const filePath = join(process.cwd(), 'dist', 'client', url.pathname);
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
    }
    // Dev server: dist/client/ doesn't exist yet, fetch from Astro dev server.
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url.pathname}: ${res.status}`);
    return res.json() as Promise<T>;
  }
  // Cloudflare Workers: use ASSETS binding for internal static file reads.
  // Global fetch() would route through the network back to the same Worker,
  // causing a deadlock (522 timeout). The ASSETS binding reads directly from
  // co-located static assets with no network round-trip.
  const { env } = await import('../env/env.service');
  const assets = env.ASSETS as { fetch: typeof fetch };
  const res = await assets.fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url.pathname}: ${res.status}`);
  return res.json() as Promise<T>;
}

/**
 * Two-tier loading with static JSON fallback (replaces virtual module lookup).
 * Tier 1: D1 cache (same as before)
 * Tier 2: Fetch from prerendered JSON endpoint
 */
export async function loadDetailFromJson<T>(opts: {
  contentType: string;
  id: string | undefined;
  jsonUrl: URL;
  fromCache: (blob: string) => T;
}): Promise<{ data: T; notFound: false } | { notFound: true }> {
  if (!opts.id) return { notFound: true };

  const database = getDb();

  // Tier 1: D1 cache
  const cached = await database.select().from(contentEdits)
    .where(and(
      eq(contentEdits.city, CITY),
      eq(contentEdits.contentType, opts.contentType),
      eq(contentEdits.contentSlug, opts.id),
    ))
    .get();

  if (cached) {
    try {
      const data = opts.fromCache(cached.data);
      return { data, notFound: false };
    } catch {
      console.warn(`Invalid cache for ${opts.contentType}/${opts.id}, falling back to JSON`);
    }
  }

  // Tier 2: Static JSON
  try {
    const data = await fetchJson<T>(opts.jsonUrl);
    return { data, notFound: false };
  } catch {
    return { notFound: true };
  }
}

/**
 * Load an admin list from a static JSON endpoint, with D1 cache overlay.
 * Fetches the build-time list from JSON, then overlays D1 cached edits.
 */
export async function loadListFromJson<TItem, TCached>(
  config: Omit<AdminListOverlayConfig<TItem, TCached>, 'buildTimeItems'> & {
    jsonUrl: URL;
  },
): Promise<{ items: TItem[]; pendingIds: Set<string> }> {
  const buildTimeItems = await fetchJson<TItem[]>(config.jsonUrl);
  return loadAdminContentList({ ...config, buildTimeItems });
}

/**
 * Fetch the media-shared-keys map from the static JSON endpoint.
 * Used by save handlers that need the registry for media key tracking.
 */
export async function fetchSharedKeysData(baseUrl: URL): Promise<Record<string, Array<{ type: string; slug: string }>>> {
  return fetchJson(new URL('/admin/data/media-shared-keys.json', baseUrl));
}
