/**
 * Vite plugin that provides build-time data for modules that use Node.js `fs`.
 *
 * Problem: The Cloudflare adapter prerenders pages inside workerd, which can't
 * access the host filesystem. Modules like config/city-config.ts use fs.readFileSync
 * to load config files, which works in Node.js but fails in workerd.
 *
 * Solution: This plugin reads the data at config time (Node.js) and replaces
 * the module contents during the Vite build via the `transform` hook. The
 * original files still work in Node.js (for config evaluation, content loaders,
 * tests) but get replaced with pre-loaded data during the build.
 *
 * For map-thumbnails.ts, we use a virtual module since it's not in the config
 * import chain.
 */
// AGENTS.md: virtual-modules.d.ts is ambient — NO top-level imports or it breaks all declarations.
// Detail module names strip trailing 's': admin-routes → admin-route-detail.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import matter from 'gray-matter';
import type { Plugin } from 'vite';
import { CITY } from './lib/config/config';
import { CONTENT_DIR, cityDir } from './lib/config/config.server';
import { loadAdminRouteData, loadRouteTrackPoints } from './loaders/admin-routes';
import { loadAdminEventData } from './loaders/admin-events';
import { loadAdminOrganizers } from './loaders/admin-organizers';
import { loadAdminPlaceData } from './loaders/admin-places';
import { loadAdminRideData } from './loaders/admin-rides';
import { loadAdminBikePathData } from './loaders/admin-bike-paths';
import { buildMediaLocations, buildNearbyMediaMap, type ParkedMedia } from './loaders/media-locations';
import { buildSharedKeysMap, serializeSharedKeys } from './lib/media/media-registry';
import { isBlogInstance } from './lib/config/city-config';
import { getContentTypes } from './lib/content/content-types.server';
import { buildRideRedirectMap } from './lib/build-ride-redirect-map';
import { parseBikePathsYml } from './lib/bike-paths/bikepaths-yml';

// Project root for resolving project-internal paths (webfonts, maps cache)
const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');

export { CONTENT_DIR, CITY };
export { loadAdminRouteData };
export { loadAdminEventData };
export { loadAdminOrganizers };
export { loadAdminPlaceData };
export { loadAdminRideData };
export { loadAdminBikePathData };

const CITY_DIR = cityDir;

// --- File-reading helpers ---

function loadParkedMedia(): ParkedMedia[] {
  const filePath = path.join(CITY_DIR, 'parked-media.yml');
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8');
  return (yaml.load(raw) as ParkedMedia[]) || [];
}

function loadPlacePhotoKeys(): Array<{ slug: string; photo_key?: string }> {
  const placesDir = path.join(CITY_DIR, 'places');
  if (!fs.existsSync(placesDir)) return [];
  return fs.readdirSync(placesDir)
    .filter(f => f.endsWith('.md') && !f.match(/\.\w{2}\.md$/))
    .map(f => {
      const content = fs.readFileSync(path.join(placesDir, f), 'utf-8');
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) return { slug: f.replace('.md', '') };
      const fm = yaml.load(fmMatch[1]) as Record<string, unknown>;
      return { slug: f.replace('.md', ''), photo_key: fm.photo_key as string | undefined };
    });
}

function loadEventPosterKeys(): Array<{ slug: string; poster_key?: string }> {
  const eventsDir = path.join(CITY_DIR, 'events');
  if (!fs.existsSync(eventsDir)) return [];
  const results: Array<{ slug: string; poster_key?: string }> = [];
  for (const yearDir of fs.readdirSync(eventsDir).filter(d => /^\d{4}$/.test(d))) {
    const yearPath = path.join(eventsDir, yearDir);
    for (const f of fs.readdirSync(yearPath).filter(f => f.endsWith('.md') && !f.match(/\.\w{2}\.md$/))) {
      const content = fs.readFileSync(path.join(yearPath, f), 'utf-8');
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;
      const fm = yaml.load(fmMatch[1]) as Record<string, unknown>;
      results.push({ slug: `${yearDir}/${f.replace('.md', '')}`, poster_key: fm.poster_key as string | undefined });
    }
  }
  return results;
}

function loadCityConfig() {
  return yaml.load(fs.readFileSync(path.join(CITY_DIR, 'config.yml'), 'utf-8'));
}

function loadHomepageFacts(): Record<string, unknown[]> {
  const config = yaml.load(fs.readFileSync(path.join(CITY_DIR, 'config.yml'), 'utf-8')) as { locale: string; locales?: string[] };
  const defaultLocale = config.locale.split('-')[0];
  const locales = (config.locales || [config.locale]).map((l: string) => l.split('-')[0]);

  const result: Record<string, unknown[]> = {};

  // Load default locale facts
  const defaultPath = path.join(CITY_DIR, 'homepage-facts.yml');
  if (fs.existsSync(defaultPath)) {
    const parsed = yaml.load(fs.readFileSync(defaultPath, 'utf-8')) as { facts?: unknown[] } | null;
    result[defaultLocale] = parsed?.facts || [];
  }

  // Load locale-specific overrides (e.g. homepage-facts.fr.yml)
  for (const locale of locales) {
    if (locale === defaultLocale) continue;
    const localePath = path.join(CITY_DIR, `homepage-facts.${locale}.yml`);
    if (fs.existsSync(localePath)) {
      const parsed = yaml.load(fs.readFileSync(localePath, 'utf-8')) as { facts?: unknown[] } | null;
      result[locale] = parsed?.facts || [];
    }
  }

  return result;
}

function loadTagTranslations() {
  const filePath = path.join(CITY_DIR, 'tag-translations.yml');
  if (!fs.existsSync(filePath)) return {};
  return yaml.load(fs.readFileSync(filePath, 'utf-8')) || {};
}

function loadBikePaths() {
  const filePath = path.join(CITY_DIR, 'bikepaths.yml');
  if (!fs.existsSync(filePath)) return [];
  return parseBikePathsYml(fs.readFileSync(filePath, 'utf-8'));
}

function loadGeoFiles(consumerRoot: string): string[] {
  const geoDir = path.join(consumerRoot, 'public', 'paths', 'geo');
  if (!fs.existsSync(geoDir)) return [];
  return fs.readdirSync(geoDir).filter(f => f.endsWith('.geojson'));
}

/**
 * Load GeoJSON geometry files and extract sampled coordinates per relation ID.
 * This provides geographic data for relation-based paths that lack anchors in the YML.
 * Sample every Nth point to keep the data small but geographically representative.
 */
function loadGeoCoordinates(consumerRoot: string): Record<string, Array<{ lat: number; lng: number }>> {
  const geoDir = path.join(consumerRoot, 'public', 'paths', 'geo');
  if (!fs.existsSync(geoDir)) return {};
  const result: Record<string, Array<{ lat: number; lng: number }>> = {};
  const SAMPLE_INTERVAL = 10; // keep every 10th point

  for (const file of fs.readdirSync(geoDir).filter(f => f.endsWith('.geojson'))) {
    const relId = file.replace(/\.geojson$/, '');
    try {
      const geojson = JSON.parse(fs.readFileSync(path.join(geoDir, file), 'utf-8'));
      const points: Array<{ lat: number; lng: number }> = [];
      for (const feature of geojson.features ?? []) {
        if (feature.geometry?.type === 'LineString') {
          const coords = feature.geometry.coordinates;
          for (let i = 0; i < coords.length; i += SAMPLE_INTERVAL) {
            points.push({ lat: coords[i][1], lng: coords[i][0] });
          }
          // Always include the last point
          if (coords.length > 0) {
            const last = coords[coords.length - 1];
            points.push({ lat: last[1], lng: last[0] });
          }
        }
      }
      if (points.length > 0) result[relId] = points;
    } catch {
      // Malformed file — skip
    }
  }
  return result;
}

import { haversineM, PLACE_NEAR_ROUTE_M } from './lib/geo/proximity';

/** Bounding box for a set of points, with padding in degrees (~100m ≈ 0.001°). */
function boundingBox(points: Array<{ lat: number; lng: number }>, padDeg = 0.001) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { minLat: minLat - padDeg, maxLat: maxLat + padDeg, minLng: minLng - padDeg, maxLng: maxLng + padDeg };
}

/** Check if two bounding boxes overlap. */
function bboxOverlap(
  a: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  b: { minLat: number; maxLat: number; minLng: number; maxLng: number },
): boolean {
  return a.minLat <= b.maxLat && a.maxLat >= b.minLat && a.minLng <= b.maxLng && a.maxLng >= b.minLng;
}

/** Check if a route track passes near a set of path points (any point within threshold). */
function trackPassesNearPoints(
  trackPoints: Array<{ lat: number; lng: number }>,
  trackBbox: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  pathPoints: Array<{ lat: number; lng: number }>,
  pathBbox: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  thresholdM = 100,
): boolean {
  // Fast reject: if bounding boxes don't overlap, no point checking individual points
  if (!bboxOverlap(trackBbox, pathBbox)) return false;

  for (const pp of pathPoints) {
    // Skip path points outside the track bbox
    if (pp.lat < trackBbox.minLat || pp.lat > trackBbox.maxLat ||
        pp.lng < trackBbox.minLng || pp.lng > trackBbox.maxLng) continue;
    for (const tp of trackPoints) {
      if (haversineM(tp.lat, tp.lng, pp.lat, pp.lng) <= thresholdM) return true;
    }
  }
  return false;
}

interface RouteCard {
  slug: string;
  name: string;
  distance_km: number;
  coverKey?: string;
}

interface PathRelations {
  overlappingRoutes: RouteCard[];
  nearbyPlaces: NearbyPlace[];
  nearbyPaths: Array<{ slug: string; name: string; surface?: string }>;
  connectedPaths: Array<{ slug: string; name: string; surface?: string }>;
}

/**
 * Precompute ALL bike-path relationships at config time.
 * This replaces the heavy computation that was happening in workerd prerendering.
 */
interface NearbyPlace {
  name: string;
  category: string;
  lat: number;
  lng: number;
  distance_m: number;
}

function computeBikePathRelations(
  bikePaths: ReturnType<typeof parseBikePathsYml>,
  geoCoords: Record<string, Array<{ lat: number; lng: number }>>,
  routeTracks: Record<string, Array<{ lat: number; lng: number }>>,
  places: Array<{ name: string; category: string; lat: number; lng: number; status?: string }>,
): { relations: Record<string, PathRelations>; routeOverlaps: Record<string, { count: number }> } {
  const publishedPlaces = places.filter(p => !p.status || p.status === 'published');
  const relations: Record<string, PathRelations> = {};
  const routeOverlaps: Record<string, { count: number }> = {};

  // Load route metadata (name, distance_km, cover) from frontmatter
  const routeMeta = new Map<string, { name: string; distance_km: number; coverKey?: string }>();
  const routesDir = path.join(CITY_DIR, 'routes');
  if (fs.existsSync(routesDir)) {
    for (const slug of fs.readdirSync(routesDir)) {
      const indexPath = path.join(routesDir, slug, 'index.md');
      if (!fs.existsSync(indexPath)) continue;
      const { data: fm } = matter(fs.readFileSync(indexPath, 'utf-8'));
      if (fm.status !== 'published') continue;
      // Find cover media key from media.yml
      let coverKey: string | undefined;
      const mediaPath = path.join(routesDir, slug, 'media.yml');
      if (fs.existsSync(mediaPath)) {
        const media = yaml.load(fs.readFileSync(mediaPath, 'utf-8'));
        if (Array.isArray(media)) {
          const cover = media.find((m: { cover?: boolean }) => m.cover);
          if (cover?.key) coverKey = cover.key;
          else if (media[0]?.key) coverKey = media[0].key;
        }
      }
      routeMeta.set(slug, {
        name: fm.name as string || slug,
        distance_km: (fm.distance_km as number) || 0,
        coverKey,
      });
    }
  }

  // Precompute route bounding boxes
  const routeBboxes = new Map<string, ReturnType<typeof boundingBox>>();
  for (const [slug, pts] of Object.entries(routeTracks)) {
    if (pts.length > 0) routeBboxes.set(slug, boundingBox(pts));
  }

  // Build points per entry slug
  const entryPoints = new Map<string, Array<{ lat: number; lng: number }>>();
  for (const entry of bikePaths) {
    const anchors = (entry.anchors ?? []).map((a: unknown) =>
      Array.isArray(a) ? { lat: (a as number[])[1], lng: (a as number[])[0] } : a as { lat: number; lng: number }
    );
    let points = anchors.length > 0 ? anchors : [] as Array<{ lat: number; lng: number }>;
    if (points.length === 0) {
      for (const relId of entry.osm_relations ?? []) {
        const coords = geoCoords[String(relId)];
        if (coords) points = points.concat(coords);
      }
    }
    entryPoints.set(entry.slug, points);
  }

  // For each entry, compute route overlaps
  for (const entry of bikePaths) {
    const points = entryPoints.get(entry.slug) ?? [];
    if (points.length === 0) {
      routeOverlaps[entry.slug] = { count: 0 };
      relations[entry.slug] = { overlappingRoutes: [], nearbyPlaces: [], nearbyPaths: [], connectedPaths: [] };
      continue;
    }

    const pathBbox = boundingBox(points);

    // Route overlaps
    const overlappingRoutes: RouteCard[] = [];
    for (const [routeSlug, trackPoints] of Object.entries(routeTracks)) {
      if (trackPoints.length === 0) continue;
      const trackBbox = routeBboxes.get(routeSlug);
      if (!trackBbox) continue;
      if (trackPassesNearPoints(trackPoints, trackBbox, points, pathBbox)) {
        const meta = routeMeta.get(routeSlug);
        if (meta) {
          overlappingRoutes.push({ slug: routeSlug, ...meta });
        }
      }
    }
    routeOverlaps[entry.slug] = { count: overlappingRoutes.length };

    // Nearby paths (within 2km)
    const nearbyPaths: Array<{ slug: string; name: string; surface?: string }> = [];
    for (const other of bikePaths) {
      if (other.slug === entry.slug) continue;
      const otherPts = entryPoints.get(other.slug) ?? [];
      if (otherPts.length === 0) continue;
      const otherBbox = boundingBox(otherPts, 0.02); // ~2km padding
      if (!bboxOverlap(pathBbox, otherBbox)) continue;
      let found = false;
      for (const a of points) {
        if (found) break;
        for (const b of otherPts) {
          if (haversineM(a.lat, a.lng, b.lat, b.lng) < 2000) { found = true; break; }
        }
      }
      if (found) nearbyPaths.push({ slug: other.slug, name: other.name, surface: other.surface });
    }

    // Connected paths (endpoints within 200m)
    const endpoints = points.length >= 2
      ? [points[0], points[points.length - 1]]
      : points.slice(0, 1);
    const connectedPaths: Array<{ slug: string; name: string; surface?: string }> = [];
    for (const other of bikePaths) {
      if (other.slug === entry.slug) continue;
      const otherPts = entryPoints.get(other.slug) ?? [];
      if (otherPts.length === 0) continue;
      const otherEndpoints = otherPts.length >= 2
        ? [otherPts[0], otherPts[otherPts.length - 1]]
        : otherPts.slice(0, 1);
      let found = false;
      for (const ep of endpoints) {
        if (found) break;
        for (const oep of otherEndpoints) {
          if (haversineM(ep.lat, ep.lng, oep.lat, oep.lng) < 200) { found = true; break; }
        }
      }
      if (found) connectedPaths.push({ slug: other.slug, name: other.name, surface: other.surface });
    }

    // Nearby places (within threshold of any path point)
    const PLACE_NEAR_M = PLACE_NEAR_ROUTE_M;
    const nearbyPlaces: NearbyPlace[] = [];
    for (const place of publishedPlaces) {
      let minDist = Infinity;
      for (const pp of points) {
        const d = haversineM(pp.lat, pp.lng, place.lat, place.lng);
        if (d < minDist) minDist = d;
        if (d <= PLACE_NEAR_M) break; // early exit
      }
      if (minDist <= PLACE_NEAR_M) {
        nearbyPlaces.push({ name: place.name, category: place.category, lat: place.lat, lng: place.lng, distance_m: Math.round(minDist) });
      }
    }
    nearbyPlaces.sort((a, b) => a.distance_m - b.distance_m);

    relations[entry.slug] = { overlappingRoutes, nearbyPlaces, nearbyPaths, connectedPaths };
  }

  return { relations, routeOverlaps };
}

function loadFontPreloads() {
  const content = fs.readFileSync(path.join(PROJECT_ROOT, 'src/styles/_webfonts.scss'), 'utf-8');
  const regex = /\/\* latin \*\/\s*@font-face\s*\{[^}]*url\('([^']+)'\)/g;
  const urls = new Set<string>();
  let match;
  while ((match = regex.exec(content)) !== null) {
    urls.add(match[1]);
  }
  return [...urls];
}

function loadContributors(rootDir?: string): Array<{ username: string; gravatarHash: string }> {
  const filePath = path.join(rootDir || PROJECT_ROOT, '.astro', 'contributors.json');
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/** Scan a directory for route map thumbnails, returning cache keys. */
function scanMapDir(dir: string, prefix?: string) {
  const maps: string[] = [];
  if (!fs.existsSync(dir)) return maps;
  for (const slug of fs.readdirSync(dir)) {
    const slugDir = path.join(dir, slug);
    if (!fs.statSync(slugDir).isDirectory()) continue;
    if (fs.existsSync(path.join(slugDir, 'map-750.webp'))) {
      maps.push(prefix ? `${prefix}/${slug}` : slug);
    }
    for (const sub of fs.readdirSync(slugDir)) {
      const subDir = path.join(slugDir, sub);
      if (fs.statSync(subDir).isDirectory() && fs.existsSync(path.join(subDir, 'map-750.webp'))) {
        maps.push(prefix ? `${prefix}/${slug}/${sub}` : `${slug}/${sub}`);
      }
    }
  }
  return maps;
}

function loadCachedMaps(rootDir?: string) {
  const cacheDir = path.join(rootDir || PROJECT_ROOT, 'public', 'maps');
  const maps: string[] = scanMapDir(cacheDir);
  // Scan locale subdirectories (2-letter dirs like "fr", "es")
  if (fs.existsSync(cacheDir)) {
    for (const entry of fs.readdirSync(cacheDir)) {
      if (entry.length === 2 && fs.statSync(path.join(cacheDir, entry)).isDirectory()) {
        maps.push(...scanMapDir(path.join(cacheDir, entry), entry));
      }
    }
  }
  return maps;
}

// --- Admin module registration ---

interface AdminModuleConfig {
  /** Module name without prefix, e.g. 'routes' → virtual:bike-app/admin-routes + admin-route-detail */
  name: string;
  /** Async function that returns { list, details } */
  loader: () => Promise<{ list: unknown; details: unknown }>;
}

// All admin module names that any view might dynamically import.
// Inactive modules (e.g. admin-events on a blog instance) get empty stubs
// so Rollup can resolve them even when the content type isn't registered.
const ALL_ADMIN_MODULE_NAMES = ['routes', 'events', 'places', 'organizers', 'bike-paths'];

function registerAdminModules(configs: AdminModuleConfig[]) {
  const promises = new Map<string, Promise<{ list: unknown; details: unknown }>>();
  const moduleIds = new Map<string, { type: 'list' | 'detail'; name: string }>();

  for (const name of ALL_ADMIN_MODULE_NAMES) {
    const listId = `virtual:bike-app/admin-${name}`;
    const detailId = `virtual:bike-app/admin-${name.replace(/s$/, '')}-detail`;
    moduleIds.set(listId, { type: 'list', name });
    moduleIds.set(detailId, { type: 'detail', name });
  }

  for (const config of configs) {
    promises.set(config.name, config.loader());
  }

  return {
    resolveId(id: string): string | undefined {
      if (moduleIds.has(id)) return `\0${id}`;
    },
    async load(id: string): Promise<string | undefined> {
      for (const [virtualId, meta] of moduleIds) {
        if (id === `\0${virtualId}`) {
          const promise = promises.get(meta.name);
          if (!promise) {
            // Inactive content type — return empty stub
            return meta.type === 'list'
              ? 'export default [];'
              : 'export default {};';
          }
          const data = await promise;
          const value = meta.type === 'list' ? data.list : data.details;
          return `export default ${JSON.stringify(value)};`;
        }
      }
    },
  };
}

// --- Virtual module builders (complex data composition) ---

function loadBikePathPhotoKeys(): Array<{ slug: string; photo_key?: string }> {
  const bikePathsDir = path.join(CITY_DIR, 'bike-paths');
  if (!fs.existsSync(bikePathsDir)) return [];
  return fs.readdirSync(bikePathsDir)
    .filter(f => f.endsWith('.md') && !f.match(/\.\w{2}\.md$/))
    .map(f => {
      const content = fs.readFileSync(path.join(bikePathsDir, f), 'utf-8');
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) return { slug: f.replace('.md', '') };
      const fm = yaml.load(fmMatch[1]) as Record<string, unknown>;
      return { slug: f.replace('.md', ''), photo_key: fm.photo_key as string | undefined };
    });
}

function buildMediaSharedKeysModule(
  routeDetails: Record<string, { media: Array<{ key: string }> }>,
): string {
  const routeData: Record<string, { media: Array<{ key: string }> }> = {};
  for (const [slug, detail] of Object.entries(routeDetails)) {
    routeData[slug] = { media: detail.media || [] };
  }
  const parked = loadParkedMedia();
  const places = loadPlacePhotoKeys();
  const events = loadEventPosterKeys();
  const bikePaths = loadBikePathPhotoKeys();
  const map = buildSharedKeysMap(routeData, places, events, parked, bikePaths);
  return `export default ${serializeSharedKeys(map)};`;
}

function loadRedirectsYaml(): Record<string, unknown> {
  const redirectsPath = path.join(CITY_DIR, 'redirects.yml');
  return fs.existsSync(redirectsPath)
    ? (yaml.load(fs.readFileSync(redirectsPath, 'utf-8')) as Record<string, unknown>) || {}
    : {};
}

function buildRideRedirectsModule(): string {
  const data = loadRedirectsYaml();
  const rideEntries = (data.rides as Array<{ from: string; to: string }>) || [];

  const map = buildRideRedirectMap(rideEntries);
  return `export default ${JSON.stringify(map)};`;
}

function buildRouteRedirectsModule(): string {
  const data = loadRedirectsYaml();
  const routeEntries = (data.routes as Array<{ from: string; to: string }>) || [];

  const map: Record<string, string> = {};
  for (const r of routeEntries) map[r.from] = r.to;
  return `export default ${JSON.stringify(map)};`;
}

function buildContentRedirectsModule(): string {
  const data = loadRedirectsYaml();
  const map: Record<string, string> = {};

  const sections: Record<string, string> = {
    routes: '/routes/',
    guides: '/guides/',
    videos: '/videos/',
    tours: '/tours/',
  };
  for (const [key, prefix] of Object.entries(sections)) {
    const entries = data[key] as Array<{ from: string; to: string }> | undefined;
    if (entries) {
      for (const r of entries) map[`${prefix}${r.from}`] = `${prefix}${r.to}`;
    }
  }

  const shortUrls = data.short_urls as Array<{ from: string; to: string }> | undefined;
  if (shortUrls) {
    for (const r of shortUrls) map[`/${r.from}`] = r.to;
  }

  // Per-route redirects (e.g. old /rides/* URLs → /routes/{slug})
  const routesDir = path.join(CITY_DIR, 'routes');
  if (fs.existsSync(routesDir)) {
    for (const slug of fs.readdirSync(routesDir)) {
      const routeRedirects = path.join(routesDir, slug, 'redirects.yml');
      if (!fs.existsSync(routeRedirects)) continue;
      const routeEntries = yaml.load(fs.readFileSync(routeRedirects, 'utf-8'));
      if (Array.isArray(routeEntries)) {
        for (const from of routeEntries as string[]) {
          map[from] = `/routes/${slug}`;
        }
      }
    }
  }

  return `export default ${JSON.stringify(map)};`;
}

function buildVideoRouteMapModule(): string {
  const routesDir = path.join(CITY_DIR, 'routes');
  const map: Record<string, string> = {};

  if (fs.existsSync(routesDir)) {
    for (const slug of fs.readdirSync(routesDir)) {
      const mediaPath = path.join(routesDir, slug, 'media.yml');
      if (!fs.existsSync(mediaPath)) continue;
      const media = yaml.load(fs.readFileSync(mediaPath, 'utf-8'));
      if (!Array.isArray(media)) continue;
      for (const item of media) {
        if (item.type === 'video' && item.handle) {
          map[item.handle] = slug;
        }
      }
    }
  }

  return `export default ${JSON.stringify(map)};`;
}

// --- Plugin ---

export function buildDataPlugin(options?: { consumerRoot?: string }): Plugin {
  // CONSUMER_ROOT = the project that depends on this package (for public/, .astro/, _cache/).
  // PROJECT_ROOT = this package itself (for src/styles/, internal assets).
  const CONSUMER_ROOT = options?.consumerRoot || PROJECT_ROOT;
  const cityConfig = loadCityConfig();
  const tagTranslations = loadTagTranslations();
  const bikePaths = loadBikePaths();
  const geoFiles = loadGeoFiles(CONSUMER_ROOT);
  const geoCoordinates = loadGeoCoordinates(CONSUMER_ROOT);
  const routeTracks = loadRouteTrackPoints();
  // Load places for nearby-places computation
  const placesDir = path.join(CITY_DIR, 'places');
  const placeList: Array<{ name: string; category: string; lat: number; lng: number; status?: string }> = [];
  if (fs.existsSync(placesDir)) {
    for (const file of fs.readdirSync(placesDir).filter(f => f.endsWith('.md') && !f.includes('.'))) {
      const { data } = matter(fs.readFileSync(path.join(placesDir, file), 'utf-8'));
      if (data.lat != null && data.lng != null) {
        placeList.push({ name: data.name as string, category: data.category as string, lat: data.lat as number, lng: data.lng as number, status: data.status as string });
      }
    }
  }
  const { relations: bikePathRelations, routeOverlaps } = computeBikePathRelations(bikePaths, geoCoordinates, routeTracks, placeList);
  const fontPreloads = loadFontPreloads();
  const homepageFacts = loadHomepageFacts();
  const cachedMaps = loadCachedMaps(CONSUMER_ROOT);
  const contributors = loadContributors(CONSUMER_ROOT);

  // Load admin data eagerly (async) so it's ready when load() is called.
  // Merged loaders compute routes+details and events+details in single passes.
  const isBlog = isBlogInstance();
  const adminRouteDataPromise = isBlog ? null : loadAdminRouteData();
  const adminRideDataPromise = isBlog ? loadAdminRideData() : null;
  const adminEventDataPromise = loadAdminEventData();
  const adminPlaceDataPromise = loadAdminPlaceData();
  const adminOrganizersPromise = loadAdminOrganizers();
  const adminBikePathDataPromise = loadAdminBikePathData();

  // Helper: resolve route/ride details (used by multiple virtual modules)
  async function getRouteDetails() {
    return isBlog
      ? (await adminRideDataPromise!).details
      : (await adminRouteDataPromise!).details;
  }

  // Map content type names to loaders using statically-imported functions.
  // Dynamic import() can't be used here — Vite's module runner isn't available
  // during astro:config:setup. Blog instances register ride data under the
  // 'routes' module name since admin components import virtual:bike-app/admin-routes.
  const loaderMap: Record<string, () => Promise<{ list: unknown; details: unknown }>> = {
    routes: isBlog
      ? async () => { const d = await adminRideDataPromise!; return { list: d.rides, details: d.details }; }
      : async () => { const d = await adminRouteDataPromise!; return { list: d.routes, details: d.details }; },
    events: async () => { const d = await adminEventDataPromise; return { list: d.events, details: d.details }; },
    places: async () => { const d = await adminPlaceDataPromise; return { list: d.places, details: d.details }; },
    organizers: async () => { const d = await adminOrganizersPromise; return { list: d.list, details: d.details }; },
    'bike-paths': async () => { const d = await adminBikePathDataPromise; return { list: d.bikePaths, details: d.details }; },
  };

  // Build admin modules from the content type registry, using the loader map
  const activeTypes = getContentTypes();
  const adminModuleConfigs = activeTypes
    .map(ct => {
      // Blog: rides type serves the routes virtual module
      const moduleName = (isBlog && ct.name === 'rides') ? 'routes' : ct.name;
      return loaderMap[moduleName] ? { name: moduleName, loader: loaderMap[moduleName] } : null;
    })
    .filter((c): c is AdminModuleConfig => c !== null);

  const adminModules = registerAdminModules(adminModuleConfigs);

  // Non-admin virtual modules — each key maps to an async loader returning JS source
  const PREFIX = 'virtual:bike-app/';
  const virtualModules: Record<string, () => Promise<string>> = {
    'cached-maps': async () =>
      `export default new Set(${JSON.stringify(cachedMaps)});`,

    'contributors': async () =>
      `export default ${JSON.stringify(contributors)};`,

    'parked-media': async () =>
      `export default ${JSON.stringify(loadParkedMedia())};`,

    'media-locations': async () => {
      const details = await getRouteDetails();
      const parked = loadParkedMedia();
      return `export default ${JSON.stringify(buildMediaLocations(details, parked))};`;
    },

    'nearby-media': async () => {
      if (isBlog) return `export default ${JSON.stringify({})};`;
      const details = await getRouteDetails();
      const parked = loadParkedMedia();
      const locations = buildMediaLocations(details, parked);
      const tracks = loadRouteTrackPoints();
      return `export default ${JSON.stringify(buildNearbyMediaMap(locations, tracks))};`;
    },

    'media-shared-keys': async () => {
      const details = await getRouteDetails();
      return buildMediaSharedKeysModule(details);
    },

    'tours': async () => {
      if (!adminRideDataPromise) return `export default [];`;
      const { tours } = await adminRideDataPromise;
      return `export default ${JSON.stringify(tours)};`;
    },

    'ride-stats': async () => {
      if (!adminRideDataPromise) {
        return `export default ${JSON.stringify({
          total_distance_km: 0, total_elevation_m: 0, total_rides: 0,
          total_tours: 0, total_days: 0, countries: [],
          by_year: {}, by_country: {}, records: {},
        })};`;
      }
      const { stats } = await adminRideDataPromise;
      return `export default ${JSON.stringify(stats)};`;
    },

    'ride-redirects': async () => buildRideRedirectsModule(),
    'route-redirects': async () => buildRouteRedirectsModule(),
    'content-redirects': async () => buildContentRedirectsModule(),
    'video-route-map': async () => buildVideoRouteMapModule(),

    'homepage-facts': async () =>
      `export default ${JSON.stringify(homepageFacts)};`,
  };

  return {
    name: 'bike-app-build-data',

    resolveId(id: string) {
      const adminResolved = adminModules.resolveId(id);
      if (adminResolved) return adminResolved;
      const key = id.startsWith(PREFIX) ? id.slice(PREFIX.length) : null;
      if (key && key in virtualModules) return `\0${id}`;
    },

    async load(id: string) {
      const adminLoaded = await adminModules.load(id);
      if (adminLoaded) return adminLoaded;
      const key = id.startsWith(`\0${PREFIX}`) ? id.slice(PREFIX.length + 1) : null;
      if (key && key in virtualModules) return virtualModules[key]();
    },

    // Replace fs-dependent modules with pre-loaded data during the build.
    // These files use fs.readFileSync which works in Node.js (config eval, tests)
    // but fails in workerd. The transform hook replaces them with static data.
    transform(code: string, id: string) {
      if (id.endsWith('src/lib/config/city-config.ts')) {
        return {
          code: `
const _data = ${JSON.stringify(cityConfig)};
export function getCityConfig() { return _data; }
export function isBlogInstance() { return _data.instance_type === 'blog'; }
export function isClubInstance() { return _data.instance_type === 'club'; }
`,
          map: null,
        };
      }
      if (id.endsWith('src/lib/i18n/tag-translations.server.ts')) {
        return {
          code: `
import { shortLocale, defaultLocale } from './locale-utils';
const _translations = ${JSON.stringify(tagTranslations)};
export function loadTagTranslations() {
  return _translations;
}
export function tTag(tag, locale) {
  const short = shortLocale(locale || defaultLocale());
  const entry = _translations[tag];
  return entry?.[short] ?? tag;
}
`,
          map: null,
        };
      }
      if (id.endsWith('src/lib/fonts.server.ts')) {
        return {
          code: `
const _data = ${JSON.stringify(fontPreloads)};
export function getFontPreloads() { return _data; }
`,
          map: null,
        };
      }
      if (id.endsWith('src/lib/bike-paths/bike-path-data.server.ts')) {
        return {
          code: `
import { getCollection } from 'astro:content';
import { scoreBikePath, isHardExcluded, SCORE_THRESHOLD } from './bike-path-scoring';
import { haversineM } from '../geo/proximity';

const _NCC_NORMALIZE = /\\b(ncc|ccn|national capital commission|commission de la capitale nationale)\\b/i;
export function normalizeOperator(operator) {
  if (!operator) return undefined;
  if (_NCC_NORMALIZE.test(operator)) return 'NCC';
  return operator;
}

const _allYmlEntries = ${JSON.stringify(bikePaths)};
const _geoCoordinates = ${JSON.stringify(geoCoordinates)};
const _routeOverlaps = ${JSON.stringify(routeOverlaps)};
const _bikePathRelations = ${JSON.stringify(bikePathRelations)};

/** Get geographic points for a path: anchors from YML, falling back to sampled GeoJSON geometry. */
function getPathPoints(entry) {
  const anchors = (entry.anchors ?? []).map(a =>
    Array.isArray(a) ? { lat: a[1], lng: a[0] } : a
  );
  if (anchors.length > 0) return anchors;
  // Fall back to GeoJSON-derived coordinates for relation-based paths
  const points = [];
  for (const relId of entry.osm_relations ?? []) {
    const coords = _geoCoordinates[String(relId)];
    if (coords) points.push(...coords);
  }
  return points;
}

export async function loadBikePathData() {
  const allYmlEntries = _allYmlEntries;
  const markdownEntries = await getCollection('bike-paths');

  const ymlBySlug = new Map();
  for (const entry of allYmlEntries) {
    ymlBySlug.set(entry.slug, entry);
  }

  const claimedSlugs = new Set();
  const pages = [];

  for (const md of markdownEntries) {
    if (md.data.hidden) continue;

    const includes = md.data.includes ?? [];
    const matchedEntries = [];

    for (const inc of includes) {
      const entry = ymlBySlug.get(inc);
      if (entry) {
        matchedEntries.push(entry);
        claimedSlugs.add(inc);
      }
    }

    if (matchedEntries.length === 0) {
      const entry = ymlBySlug.get(md.id);
      if (entry) {
        matchedEntries.push(entry);
        claimedSlugs.add(md.id);
      }
    }

    const osmRelationIds = matchedEntries.flatMap(e => e.osm_relations ?? []);
    const osmNames = matchedEntries.flatMap(e => e.osm_names ?? []);
    const primary = matchedEntries[0];

    const bestChildScore = matchedEntries.reduce(
      (max, e) => Math.max(max, scoreBikePath(e, 0)),
      0,
    );

    // Collect geographic points from all matched entries (anchors or GeoJSON fallback)
    const points = matchedEntries.flatMap(e => getPathPoints(e));

    pages.push({
      slug: md.id,
      name: md.data.name ?? primary?.name ?? md.id,
      name_fr: md.data.name_fr ?? primary?.name_fr,
      vibe: md.data.vibe,
      body: md.body,
      photo_key: md.data.photo_key,
      tags: md.data.tags ?? [],
      score: bestChildScore,
      hasMarkdown: true,
      stub: md.data.stub ?? false,
      ymlEntries: matchedEntries,
      osmRelationIds,
      osmNames,
      points,
      routeCount: Math.max(...matchedEntries.map(e => _routeOverlaps[e.slug]?.count ?? 0), 0),
      // Merge precomputed relations from all included entries, deduplicated by slug
      overlappingRoutes: (() => {
        const seen = new Set();
        const routes = [];
        for (const e of matchedEntries) {
          for (const r of (_bikePathRelations[e.slug]?.overlappingRoutes ?? [])) {
            if (!seen.has(r.slug)) { seen.add(r.slug); routes.push(r); }
          }
        }
        return routes;
      })(),
      nearbyPlaces: (() => {
        const seen = new Set();
        const places = [];
        for (const e of matchedEntries) {
          for (const p of (_bikePathRelations[e.slug]?.nearbyPlaces ?? [])) {
            const key = p.name + p.lat + p.lng;
            if (!seen.has(key)) { seen.add(key); places.push(p); }
          }
        }
        return places.sort((a, b) => a.distance_m - b.distance_m);
      })(),
      nearbyPaths: (() => {
        const seen = new Set();
        const paths = [];
        for (const e of matchedEntries) {
          for (const p of (_bikePathRelations[e.slug]?.nearbyPaths ?? [])) {
            if (!seen.has(p.slug) && p.slug !== md.id) { seen.add(p.slug); paths.push(p); }
          }
        }
        return paths;
      })(),
      connectedPaths: (() => {
        const seen = new Set();
        const paths = [];
        for (const e of matchedEntries) {
          for (const p of (_bikePathRelations[e.slug]?.connectedPaths ?? [])) {
            if (!seen.has(p.slug) && p.slug !== md.id) { seen.add(p.slug); paths.push(p); }
          }
        }
        return paths;
      })(),
      surface: primary?.surface,
      width: primary?.width,
      lit: primary?.lit,
      segregated: primary?.segregated,
      smoothness: primary?.smoothness,
      operator: normalizeOperator(primary?.operator),
      network: primary?.network,
      highway: primary?.highway,
    });
  }

  for (const entry of allYmlEntries) {
    if (claimedSlugs.has(entry.slug)) continue;
    if (isHardExcluded(entry)) continue;

    const score = scoreBikePath(entry, 0);
    if (score < SCORE_THRESHOLD) continue;

    pages.push({
      slug: entry.slug,
      name: entry.name,
      name_fr: entry.name_fr,
      tags: [],
      score,
      hasMarkdown: false,
      stub: false,
      ymlEntries: [entry],
      osmRelationIds: entry.osm_relations ?? [],
      osmNames: entry.osm_names ?? [],
      points: getPathPoints(entry),
      routeCount: _routeOverlaps[entry.slug]?.count ?? 0,
      overlappingRoutes: _bikePathRelations[entry.slug]?.overlappingRoutes ?? [],
      nearbyPlaces: _bikePathRelations[entry.slug]?.nearbyPlaces ?? [],
      nearbyPaths: _bikePathRelations[entry.slug]?.nearbyPaths ?? [],
      connectedPaths: _bikePathRelations[entry.slug]?.connectedPaths ?? [],
      surface: entry.surface,
      width: entry.width,
      lit: entry.lit,
      segregated: entry.segregated,
      smoothness: entry.smoothness,
      operator: normalizeOperator(entry.operator),
      network: entry.network,
      highway: entry.highway,
    });
  }

  return { pages, allYmlEntries, geoFiles: ${JSON.stringify(geoFiles)} };
}

/** Check if a GPX track passes near any of a bike path's anchor points. */
export function routePassesNearPath(trackPoints, pathAnchors, thresholdM = 100) {
  for (const anchor of pathAnchors) {
    for (const tp of trackPoints) {
      if (haversineM(tp.lat, tp.lon, anchor.lat, anchor.lng) <= thresholdM) {
        return true;
      }
    }
  }
  return false;
}
`,
          map: null,
        };
      }
    },
  };
}
