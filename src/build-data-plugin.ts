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
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import type { Plugin } from 'vite';
import { CONTENT_DIR, CITY, cityDir } from './lib/config';
import { loadAdminRoutes, loadAdminRouteDetails } from './loaders/admin-routes';
import { loadAdminEvents, loadAdminEventDetails } from './loaders/admin-events';
import { loadAdminOrganizers } from './loaders/admin-organizers';

// Project root for resolving project-internal paths (webfonts, maps cache)
const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');

export { CONTENT_DIR, CITY };
export { loadAdminRoutes, loadAdminRouteDetails };
export { loadAdminEvents, loadAdminEventDetails };
export { loadAdminOrganizers };

const CITY_DIR = cityDir;

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

function loadCachedMaps() {
  const cacheDir = path.join(PROJECT_ROOT, 'public', 'maps');
  const maps: string[] = [];
  if (!fs.existsSync(cacheDir)) return maps;
  for (const slug of fs.readdirSync(cacheDir)) {
    const slugDir = path.join(cacheDir, slug);
    if (!fs.statSync(slugDir).isDirectory()) continue;
    if (fs.existsSync(path.join(slugDir, 'map-750.webp'))) {
      maps.push(slug);
    }
    for (const sub of fs.readdirSync(slugDir)) {
      const subDir = path.join(slugDir, sub);
      if (fs.statSync(subDir).isDirectory() && fs.existsSync(path.join(subDir, 'map-750.webp'))) {
        maps.push(`${slug}/${sub}`);
      }
    }
  }
  return maps;
}

export function buildDataPlugin(): Plugin {
  const cityConfig = loadCityConfig();
  const tagTranslations = loadTagTranslations();
  const fontPreloads = loadFontPreloads();
  const cachedMaps = loadCachedMaps();

  // Load admin data eagerly (async) so it's ready when load() is called
  const adminRoutesPromise = loadAdminRoutes();
  const adminRouteDetailsPromise = loadAdminRouteDetails();
  const adminEventsPromise = loadAdminEvents();
  const adminEventDetailsPromise = loadAdminEventDetails();
  const adminOrganizersPromise = loadAdminOrganizers();

  return {
    name: 'bike-app-build-data',

    // Virtual modules
    resolveId(id: string) {
      if (id === 'virtual:bike-app/cached-maps') return '\0virtual:bike-app/cached-maps';
      if (id === 'virtual:bike-app/admin-routes') return '\0virtual:bike-app/admin-routes';
      if (id === 'virtual:bike-app/admin-route-detail') return '\0virtual:bike-app/admin-route-detail';
      if (id === 'virtual:bike-app/admin-events') return '\0virtual:bike-app/admin-events';
      if (id === 'virtual:bike-app/admin-event-detail') return '\0virtual:bike-app/admin-event-detail';
      if (id === 'virtual:bike-app/admin-organizers') return '\0virtual:bike-app/admin-organizers';
    },
    async load(id: string) {
      if (id === '\0virtual:bike-app/cached-maps') {
        return `export default new Set(${JSON.stringify(cachedMaps)});`;
      }
      if (id === '\0virtual:bike-app/admin-routes') {
        const routes = await adminRoutesPromise;
        return `export default ${JSON.stringify(routes)};`;
      }
      if (id === '\0virtual:bike-app/admin-route-detail') {
        const details = await adminRouteDetailsPromise;
        return `export default ${JSON.stringify(details)};`;
      }
      if (id === '\0virtual:bike-app/admin-events') {
        const events = await adminEventsPromise;
        return `export default ${JSON.stringify(events)};`;
      }
      if (id === '\0virtual:bike-app/admin-event-detail') {
        const details = await adminEventDetailsPromise;
        return `export default ${JSON.stringify(details)};`;
      }
      if (id === '\0virtual:bike-app/admin-organizers') {
        const organizers = await adminOrganizersPromise;
        return `export default ${JSON.stringify(organizers)};`;
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
