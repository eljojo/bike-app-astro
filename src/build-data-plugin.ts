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
 * Map thumbnails are now served by the on-demand map image proxy.
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
import { loadBikePathEntries } from './lib/bike-paths/bike-path-entries.server';
import { computeBikePathRelations, enrichBikePathPages } from './lib/bike-paths/bike-path-relations.server';
import { loadAllGeoData } from './lib/geo/geojson-reader.server';
import { buildPlacesGeoJSON, buildPhotoTiles, type PlaceGeoInput } from './lib/geo/geojson-builders';
export { buildPlacesGeoJSON, buildPhotoTiles } from './lib/geo/geojson-builders';
export type { PlaceGeoInput, MediaLocationInput, PhotoTileInput, PhotoRouteInfo, PhotoTileData } from './lib/geo/geojson-builders';
import { supportedLocales, defaultLocale as getDefaultLocale } from './lib/i18n/locale-utils';
import { translatePath } from './lib/i18n/path-translations';
import type { FeatureCollection } from 'geojson';

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

// loadPlacePhotoKeys and loadEventPosterKeys removed — data now extracted from admin data promises.

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

function loadGeoFiles(consumerRoot: string): string[] {
  const geoDir = path.join(consumerRoot, 'public', 'bike-paths', 'geo');
  if (!fs.existsSync(geoDir)) return [];
  return fs.readdirSync(geoDir).filter(f => f.endsWith('.geojson'));
}

// GeoJSON coordinate and elevation data is now loaded via loadAllGeoData() from geojson-reader.server.ts.
// This replaces the former loadGeoCoordinates() and loadGeoElevation() functions with a single-pass reader.

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
  parkedMedia: ParkedMedia[],
  adminPlaces: Array<{ id: string; photo_key?: string }>,
  adminEvents: Array<{ id: string; slug: string; poster_key?: string }>,
): string {
  const routeData: Record<string, { media: Array<{ key: string }> }> = {};
  for (const [slug, detail] of Object.entries(routeDetails)) {
    routeData[slug] = { media: detail.media || [] };
  }
  const places = adminPlaces.map(p => ({ slug: p.id, photo_key: p.photo_key }));
  const events = adminEvents.map(e => ({ slug: e.id, poster_key: e.poster_key }));
  const bikePaths = loadBikePathPhotoKeys();
  const map = buildSharedKeysMap(routeData, places, events, parkedMedia, bikePaths);
  return `export default ${serializeSharedKeys(map)};`;
}

function loadRedirectsYaml(): Record<string, unknown> {
  const redirectsPath = path.join(CITY_DIR, 'redirects.yml');
  return fs.existsSync(redirectsPath)
    ? (yaml.load(fs.readFileSync(redirectsPath, 'utf-8')) as Record<string, unknown>) || {}
    : {};
}

function buildRideRedirectsModule(redirectsData: Record<string, unknown>): string {
  const rideEntries = (redirectsData.rides as Array<{ from: string; to: string }>) || [];

  const map = buildRideRedirectMap(rideEntries);
  return `export default ${JSON.stringify(map)};`;
}

function buildRouteRedirectsModule(redirectsData: Record<string, unknown>): string {
  const routeEntries = (redirectsData.routes as Array<{ from: string; to: string }>) || [];

  const map: Record<string, string> = {};
  for (const r of routeEntries) map[r.from] = r.to;
  return `export default ${JSON.stringify(map)};`;
}

function buildContentRedirectsModule(redirectsData: Record<string, unknown>): string {
  const data = redirectsData;
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

  // Network member redirects: flat /bike-paths/slug → nested /bike-paths/network/slug
  // Also handles locale-prefixed variants (e.g. /fr/pistes-cyclables/slug → .../network/slug)
  if (process.env.ENABLE_BIKE_PATHS !== 'false') {
    try {
      const { pages } = loadBikePathEntries();
      const members = pages.filter(p => p.memberOf && p.standalone);
      for (const p of members) {
        map[`/bike-paths/${p.slug}`] = `/bike-paths/${p.memberOf}/${p.slug}`;
      }
      // Non-default locale variants
      const locales = supportedLocales();
      const defLocale = getDefaultLocale();
      for (const locale of locales) {
        if (locale === defLocale) continue;
        for (const p of members) {
          const from = translatePath(`/bike-paths/${p.slug}`, locale);
          const to = translatePath(`/bike-paths/${p.memberOf}/${p.slug}`, locale);
          map[`/${locale}${from}`] = `/${locale}${to}`;
        }
      }
    } catch { /* bike paths not available */ }
  }

  return `export default ${JSON.stringify(map)};`;
}

function buildVideoRouteMapModule(
  routeDetails: Record<string, { media: Array<{ type?: string; handle?: string }> }>,
): string {
  const map: Record<string, string> = {};
  for (const [slug, detail] of Object.entries(routeDetails)) {
    for (const item of detail.media || []) {
      if (item.type === 'video' && item.handle) {
        map[item.handle] = slug;
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
  // Read parked-media.yml and redirects.yml once at plugin init (shared across virtual module loaders)
  const parkedMedia = loadParkedMedia();
  const redirectsData = loadRedirectsYaml();
  // Tier 1: canonical merge of bikepaths.yml + markdown entries + geometry
  const bikePathBase = loadBikePathEntries();
  const bikePaths = bikePathBase.allYmlEntries;
  const geoFiles = loadGeoFiles(CONSUMER_ROOT);
  const geoDir = path.join(CONSUMER_ROOT, 'public', 'bike-paths', 'geo');
  const { coordinates: geoCoordinates, elevation: geoElevation } = loadAllGeoData(geoDir);
  const routeTracks = loadRouteTrackPoints();
  // Load places for nearby-places computation and GeoJSON emission
  const placesDir = path.join(CITY_DIR, 'places');
  const placeList: Array<{
    name: string; category: string; lat: number; lng: number; status?: string;
    name_fr?: string; address?: string; website?: string; phone?: string;
    google_maps_url?: string; photo_key?: string;
    media?: Array<{ key: string; cover?: boolean }>;
    organizer?: string;
  }> = [];
  if (fs.existsSync(placesDir)) {
    for (const file of fs.readdirSync(placesDir).filter(f => f.endsWith('.md') && !f.match(/\.\w{2}\.md$/))) {
      const { data } = matter(fs.readFileSync(path.join(placesDir, file), 'utf-8'));
      if (data.lat != null && data.lng != null) {
        placeList.push({
          name: data.name as string,
          category: data.category as string,
          lat: data.lat as number,
          lng: data.lng as number,
          status: data.status as string | undefined,
          name_fr: data.name_fr as string | undefined,
          address: data.address as string | undefined,
          website: data.website as string | undefined,
          phone: data.phone as string | undefined,
          google_maps_url: data.google_maps_url as string | undefined,
          photo_key: data.photo_key as string | undefined,
          media: data.media as Array<{ key: string; cover?: boolean }> | undefined,
          organizer: data.organizer as string | undefined,
        });
      }
    }
  }
  // Load geolocated media for nearby-photo computation
  const mediaLocations: Array<{ key: string; lat: number; lng: number; routeSlug: string; caption?: string; width?: number; height?: number; type?: string }> = [];
  const routesDirForMedia = path.join(CITY_DIR, 'routes');
  if (fs.existsSync(routesDirForMedia)) {
    for (const slug of fs.readdirSync(routesDirForMedia)) {
      const mediaPath = path.join(routesDirForMedia, slug, 'media.yml');
      if (!fs.existsSync(mediaPath)) continue;
      const media = yaml.load(fs.readFileSync(mediaPath, 'utf-8'));
      if (!Array.isArray(media)) continue;
      for (const m of media) {
        if (m.lat != null && m.lng != null && m.key) {
          mediaLocations.push({ key: m.key, lat: m.lat, lng: m.lng, routeSlug: slug, caption: m.caption, width: m.width, height: m.height, type: m.type });
        }
      }
    }
  }

  // Build organizer name map (slug → name) for place GeoJSON enrichment
  const organizerNames = new Map<string, { name: string; website?: string }>();
  const organizerDir = path.join(CITY_DIR, 'organizers');
  if (fs.existsSync(organizerDir)) {
    for (const file of fs.readdirSync(organizerDir).filter(f => f.endsWith('.md') && !f.match(/\.\w{2}\.md$/))) {
      const { data } = matter(fs.readFileSync(path.join(organizerDir, file), 'utf-8'));
      const slug = file.replace('.md', '');
      organizerNames.set(slug, { name: data.name as string, website: data.website as string | undefined });
    }
  }

  // Emit places.geojson to public/places/geo/
  const placesGeoInput: PlaceGeoInput[] = placeList.map(p => {
    const org = p.organizer ? organizerNames.get(p.organizer) : undefined;
    return {
      ...p,
      organizer_name: org?.name,
      organizer_url: org?.website,
    };
  });
  const placesGeoJSON = buildPlacesGeoJSON(placesGeoInput, mediaLocations);
  const placesGeoDir = path.join(CONSUMER_ROOT, 'public', 'places', 'geo');
  fs.mkdirSync(placesGeoDir, { recursive: true });
  fs.writeFileSync(path.join(placesGeoDir, 'places.geojson'), JSON.stringify(placesGeoJSON));

  // Build route info map for photo tile enrichment (slug → { name, url })
  const photoRouteInfo = new Map<string, { name: string; url: string }>();
  if (fs.existsSync(routesDirForMedia)) {
    for (const slug of fs.readdirSync(routesDirForMedia)) {
      const indexPath = path.join(routesDirForMedia, slug, 'index.md');
      if (!fs.existsSync(indexPath)) continue;
      const { data } = matter(fs.readFileSync(indexPath, 'utf-8'));
      if (data.name) {
        photoRouteInfo.set(slug, { name: data.name as string, url: `/routes/${slug}` });
      }
    }
  }

  // Emit photo tiles to public/places/geo/photos/
  const { tiles: photoTiles, manifest: photoManifest } = buildPhotoTiles(mediaLocations, photoRouteInfo);
  if (photoTiles.size > 0) {
    const photoTilesDir = path.join(CONSUMER_ROOT, 'public', 'places', 'geo', 'photos');
    fs.mkdirSync(photoTilesDir, { recursive: true });
    for (const [id, tile] of photoTiles) {
      const fc: FeatureCollection = { type: 'FeatureCollection', features: tile.features };
      fs.writeFileSync(path.join(photoTilesDir, `tile-${id}.geojson`), JSON.stringify(fc));
    }
    fs.writeFileSync(path.join(photoTilesDir, 'manifest.json'), JSON.stringify(photoManifest, null, 2));
  }

  // Tier 2: compute relations per YML slug (overlapping routes, nearby photos/places/paths, connected paths)
  const { relations: bikePathRelations, routeOverlaps, routeToPaths: rawRouteToPaths } = computeBikePathRelations(bikePaths, geoCoordinates, routeTracks, placeList, mediaLocations);

  // Enrich Tier 1 pages with Tier 2 relations at config time
  const enrichedPages = enrichBikePathPages(bikePathBase.pages, bikePathRelations, routeOverlaps, geoElevation);
  // Bake geometry hashes from slug index onto pages (for map image proxy URLs)
  const slugIndexPath = path.join(CONSUMER_ROOT, 'public', 'bike-paths', 'geo', 'tiles', 'slug-index.json');
  if (fs.existsSync(slugIndexPath)) {
    const slugIndex = JSON.parse(fs.readFileSync(slugIndexPath, 'utf-8')) as Record<string, { hash: string }>;
    for (const page of enrichedPages) {
      const entry = slugIndex[page.slug];
      if (entry) page.geoHash = entry.hash;
    }
  }
  // Filter all path references to only include slugs that have generated pages
  const validSlugs = new Set(enrichedPages.map(p => p.slug));
  for (const page of enrichedPages) {
    page.nearbyPaths = page.nearbyPaths.filter(p => validSlugs.has(p.slug));
    page.connectedPaths = page.connectedPaths.filter(p => validSlugs.has(p.slug));
  }
  // Filter routeToPaths to only valid page slugs
  const enrichedRouteToPaths: Record<string, Array<{ slug: string; name: string; surface?: string }>> = {};
  for (const [routeSlug, pathList] of Object.entries(rawRouteToPaths)) {
    const valid = pathList.filter(p => validSlugs.has(p.slug));
    if (valid.length > 0) enrichedRouteToPaths[routeSlug] = valid;
  }
  const fontPreloads = loadFontPreloads();
  const homepageFacts = loadHomepageFacts();
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
    'contributors': async () =>
      `export default ${JSON.stringify(contributors)};`,

    'parked-media': async () =>
      `export default ${JSON.stringify(parkedMedia)};`,

    'media-locations': async () => {
      const details = await getRouteDetails();
      return `export default ${JSON.stringify(buildMediaLocations(details, parkedMedia))};`;
    },

    'nearby-media': async () => {
      if (isBlog) return `export default ${JSON.stringify({})};`;
      const details = await getRouteDetails();
      const locations = buildMediaLocations(details, parkedMedia);
      const tracks = routeTracks;
      return `export default ${JSON.stringify(buildNearbyMediaMap(locations, tracks))};`;
    },

    'media-shared-keys': async () => {
      const details = await getRouteDetails();
      const placeData = await adminPlaceDataPromise;
      const eventData = await adminEventDataPromise;
      return buildMediaSharedKeysModule(details, parkedMedia, placeData.places, eventData.events);
    },

    'tours': async () => {
      if (!adminRideDataPromise) return `export default [];`;
      const { tours } = await adminRideDataPromise;
      // Bake gpxHash from tour-index.json onto tour data (for map image proxy URLs)
      const tourIndexPath = path.join(CONSUMER_ROOT, 'public', 'maps', 'tour-index.json');
      if (fs.existsSync(tourIndexPath)) {
        const tourIndex = JSON.parse(fs.readFileSync(tourIndexPath, 'utf-8')) as Record<string, { hash: string }>;
        for (const tour of tours) {
          const entry = tourIndex[tour.slug];
          if (entry) tour.gpxHash = entry.hash;
        }
      }
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

    'ride-redirects': async () => buildRideRedirectsModule(redirectsData),
    'route-redirects': async () => buildRouteRedirectsModule(redirectsData),
    'content-redirects': async () => buildContentRedirectsModule(redirectsData),
    'video-route-map': async () => {
      const details = await getRouteDetails();
      return buildVideoRouteMapModule(details);
    },

    'homepage-facts': async () =>
      `export default ${JSON.stringify(homepageFacts)};`,

    'bike-path-pages': async () => {
      return `
export const pages = ${JSON.stringify(enrichedPages)};
export const allYmlEntries = ${JSON.stringify(bikePathBase.allYmlEntries)};
export const geoFiles = ${JSON.stringify(geoFiles)};
export const routeToPaths = ${JSON.stringify(enrichedRouteToPaths)};
`;
    },
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
import { pages as _pages, allYmlEntries as _allYml, geoFiles as _geoFiles, routeToPaths as _rtp } from 'virtual:bike-app/bike-path-pages';
import { haversineM } from '../geo/proximity';
export { normalizeOperator } from './bike-path-entries.server';

export async function loadBikePathData() {
  return { pages: _pages, allYmlEntries: _allYml, geoFiles: _geoFiles, routeToPaths: _rtp };
}

export function getRouteToPaths() { return _rtp; }

export function routePassesNearPath(trackPoints, pathAnchors, thresholdM = 100) {
  for (const anchor of pathAnchors) {
    for (const tp of trackPoints) {
      if (haversineM(tp.lat, tp.lon, anchor.lat, anchor.lng) <= thresholdM) return true;
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
