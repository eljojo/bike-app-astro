/**
 * Vite plugin that provides build-time data for modules that use Node.js `fs`.
 *
 * Problem: The Cloudflare adapter prerenders pages inside workerd, which can't
 * access the host filesystem. Modules like city-config.ts use fs.readFileSync
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
import type { Plugin } from 'vite';
import { CONTENT_DIR, CITY, cityDir } from './lib/config';
import { loadAdminRouteData, loadRouteTrackPoints } from './loaders/admin-routes';
import { loadAdminEventData } from './loaders/admin-events';
import { loadAdminOrganizers } from './loaders/admin-organizers';
import { loadAdminPlaceData } from './loaders/admin-places';
import { buildPhotoLocations, buildNearbyPhotosMap, type ParkedPhoto } from './loaders/photo-locations';
import { buildSharedKeysMap, serializeSharedKeys } from './lib/photo-registry';

// Project root for resolving project-internal paths (webfonts, maps cache)
const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');

export { CONTENT_DIR, CITY };
export { loadAdminRouteData };
export { loadAdminEventData };
export { loadAdminOrganizers };
export { loadAdminPlaceData };

const CITY_DIR = cityDir;

function loadParkedPhotos(): ParkedPhoto[] {
  const filePath = path.join(CITY_DIR, 'parked-photos.yml');
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8');
  return (yaml.load(raw) as ParkedPhoto[]) || [];
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

function loadTagTranslations() {
  const filePath = path.join(CITY_DIR, 'tag-translations.yml');
  if (!fs.existsSync(filePath)) return {};
  return yaml.load(fs.readFileSync(filePath, 'utf-8')) || {};
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

function loadContributors(): Array<{ username: string; gravatarHash: string }> {
  const filePath = path.join(PROJECT_ROOT, '.astro', 'contributors.json');
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

function loadCachedMaps() {
  const cacheDir = path.join(PROJECT_ROOT, 'public', 'maps');
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

interface AdminModuleConfig {
  /** Module name without prefix, e.g. 'routes' → virtual:bike-app/admin-routes + admin-route-detail */
  name: string;
  /** Async function that returns { list, details } */
  loader: () => Promise<{ list: unknown; details: unknown }>;
}

function registerAdminModules(configs: AdminModuleConfig[]) {
  const promises = new Map<string, Promise<{ list: unknown; details: unknown }>>();
  const moduleIds = new Map<string, { type: 'list' | 'detail'; name: string }>();

  for (const config of configs) {
    const listId = `virtual:bike-app/admin-${config.name}`;
    const detailId = `virtual:bike-app/admin-${config.name.replace(/s$/, '')}-detail`;
    moduleIds.set(listId, { type: 'list', name: config.name });
    moduleIds.set(detailId, { type: 'detail', name: config.name });
    promises.set(config.name, config.loader());
  }

  return {
    resolveId(id: string): string | undefined {
      if (moduleIds.has(id)) return `\0${id}`;
    },
    async load(id: string): Promise<string | undefined> {
      for (const [virtualId, meta] of moduleIds) {
        if (id === `\0${virtualId}`) {
          const data = await promises.get(meta.name)!;
          const value = meta.type === 'list' ? data.list : data.details;
          return `export default ${JSON.stringify(value)};`;
        }
      }
    },
  };
}

export function buildDataPlugin(): Plugin {
  const cityConfig = loadCityConfig();
  const tagTranslations = loadTagTranslations();
  const fontPreloads = loadFontPreloads();
  const cachedMaps = loadCachedMaps();
  const contributors = loadContributors();

  // Load admin data eagerly (async) so it's ready when load() is called.
  // Merged loaders compute routes+details and events+details in single passes.
  const adminRouteDataPromise = loadAdminRouteData();
  const adminEventDataPromise = loadAdminEventData();
  const adminPlaceDataPromise = loadAdminPlaceData();
  const adminOrganizersPromise = loadAdminOrganizers();

  const adminModules = registerAdminModules([
    { name: 'routes', loader: async () => { const d = await adminRouteDataPromise; return { list: d.routes, details: d.details }; } },
    { name: 'events', loader: async () => { const d = await adminEventDataPromise; return { list: d.events, details: d.details }; } },
    { name: 'places', loader: async () => { const d = await adminPlaceDataPromise; return { list: d.places, details: d.details }; } },
  ]);

  return {
    name: 'bike-app-build-data',

    // Virtual modules
    resolveId(id: string) {
      const adminResolved = adminModules.resolveId(id);
      if (adminResolved) return adminResolved;
      if (id === 'virtual:bike-app/cached-maps') return '\0virtual:bike-app/cached-maps';
      if (id === 'virtual:bike-app/admin-organizers') return '\0virtual:bike-app/admin-organizers';
      if (id === 'virtual:bike-app/contributors') return '\0virtual:bike-app/contributors';
      if (id === 'virtual:bike-app/photo-locations') return '\0virtual:bike-app/photo-locations';
      if (id === 'virtual:bike-app/nearby-photos') return '\0virtual:bike-app/nearby-photos';
      if (id === 'virtual:bike-app/parked-photos') return '\0virtual:bike-app/parked-photos';
      if (id === 'virtual:bike-app/photo-shared-keys') return '\0virtual:bike-app/photo-shared-keys';
    },
    async load(id: string) {
      const adminLoaded = await adminModules.load(id);
      if (adminLoaded) return adminLoaded;
      if (id === '\0virtual:bike-app/cached-maps') {
        return `export default new Set(${JSON.stringify(cachedMaps)});`;
      }
      if (id === '\0virtual:bike-app/admin-organizers') {
        const organizers = await adminOrganizersPromise;
        return `export default ${JSON.stringify(organizers)};`;
      }
      if (id === '\0virtual:bike-app/contributors') {
        return `export default ${JSON.stringify(contributors)};`;
      }
      if (id === '\0virtual:bike-app/photo-locations') {
        const { details } = await adminRouteDataPromise;
        const parked = loadParkedPhotos();
        const locations = buildPhotoLocations(details, parked);
        return `export default ${JSON.stringify(locations)};`;
      }
      if (id === '\0virtual:bike-app/nearby-photos') {
        const { details } = await adminRouteDataPromise;
        const parked = loadParkedPhotos();
        const locations = buildPhotoLocations(details, parked);
        const tracks = loadRouteTrackPoints();
        const nearbyMap = buildNearbyPhotosMap(locations, tracks);
        return `export default ${JSON.stringify(nearbyMap)};`;
      }
      if (id === '\0virtual:bike-app/parked-photos') {
        const parked = loadParkedPhotos();
        return `export default ${JSON.stringify(parked)};`;
      }
      if (id === '\0virtual:bike-app/photo-shared-keys') {
        const { details } = await adminRouteDataPromise;
        const routeData: Record<string, { media: Array<{ key: string }> }> = {};
        for (const [slug, detail] of Object.entries(details)) {
          routeData[slug] = { media: detail.media || [] };
        }
        const parked = loadParkedPhotos();
        const places = loadPlacePhotoKeys();
        const events = loadEventPosterKeys();
        const map = buildSharedKeysMap(routeData, places, events, parked);
        return `export default ${serializeSharedKeys(map)};`;
      }
    },

    // Replace fs-dependent modules with pre-loaded data during the build.
    // These files use fs.readFileSync which works in Node.js (config eval, tests)
    // but fails in workerd. The transform hook replaces them with static data.
    transform(code: string, id: string) {
      if (id.endsWith('src/lib/city-config.ts')) {
        return {
          code: `
const _data = ${JSON.stringify(cityConfig)};
export function getCityConfig() { return _data; }
export function isBlogInstance() { return _data.instance_type === 'blog'; }
`,
          map: null,
        };
      }
      if (id.endsWith('src/lib/tag-translations.ts')) {
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
      if (id.endsWith('src/lib/fonts.ts')) {
        return {
          code: `
const _data = ${JSON.stringify(fontPreloads)};
export function getFontPreloads() { return _data; }
`,
          map: null,
        };
      }
    },
  };
}
