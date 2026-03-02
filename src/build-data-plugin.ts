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
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { marked } from 'marked';
import type { Plugin } from 'vite';
import { CONTENT_DIR, CITY, cityDir } from './lib/config';

// Project root for resolving project-internal paths (webfonts, maps cache)
const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');

export { CONTENT_DIR, CITY };
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

interface AdminRoute {
  slug: string;
  name: string;
  photoCount: number;
  status: string;
}

interface AdminMediaItem {
  key: string;
  caption?: string;
  cover?: boolean;
}

interface AdminRouteDetail {
  slug: string;
  name: string;
  tagline: string;
  tags: string[];
  distance: number;
  status: string;
  body: string;
  media: AdminMediaItem[];
}

function readRouteDir(slug: string) {
  const routeDir = path.join(CITY_DIR, 'routes', slug);
  const mdPath = path.join(routeDir, 'index.md');
  const mediaPath = path.join(routeDir, 'media.yml');

  const { data: frontmatter, content: body } = matter(fs.readFileSync(mdPath, 'utf-8'));

  const rawMedia = fs.existsSync(mediaPath)
    ? (yaml.load(fs.readFileSync(mediaPath, 'utf-8')) as Array<Record<string, unknown>>) || []
    : [];

  const photos: AdminMediaItem[] = rawMedia
    .filter((m) => m.type === 'photo')
    .map((m) => {
      const item: AdminMediaItem = { key: m.key as string };
      if (m.caption != null) item.caption = m.caption as string;
      if (m.cover != null) item.cover = m.cover as boolean;
      return item;
    });

  return { frontmatter, body, photos };
}

export async function loadAdminRoutes(): Promise<AdminRoute[]> {
  const routesDir = path.join(CITY_DIR, 'routes');
  const slugs = fs.readdirSync(routesDir).filter((name) => {
    return fs.statSync(path.join(routesDir, name)).isDirectory();
  });

  const routes: AdminRoute[] = slugs.map((slug) => {
    const { frontmatter, photos } = readRouteDir(slug);
    return {
      slug,
      name: frontmatter.name as string,
      photoCount: photos.length,
      status: frontmatter.status as string,
    };
  });

  routes.sort((a, b) => a.name.localeCompare(b.name));
  return routes;
}

export async function loadAdminRouteDetails(): Promise<Record<string, AdminRouteDetail>> {
  const routesDir = path.join(CITY_DIR, 'routes');
  const slugs = fs.readdirSync(routesDir).filter((name) => {
    return fs.statSync(path.join(routesDir, name)).isDirectory();
  });

  const details: Record<string, AdminRouteDetail> = {};

  for (const slug of slugs) {
    const { frontmatter, body, photos } = readRouteDir(slug);
    details[slug] = {
      slug,
      name: frontmatter.name as string,
      tagline: (frontmatter.tagline as string) || '',
      tags: (frontmatter.tags as string[]) || [],
      distance: (frontmatter.distance_km as number) || 0,
      status: frontmatter.status as string,
      body: await marked.parse(body.trim()),
      media: photos,
    };
  }

  return details;
}

export function buildDataPlugin(): Plugin {
  const cityConfig = loadCityConfig();
  const tagTranslations = loadTagTranslations();
  const fontPreloads = loadFontPreloads();
  const cachedMaps = loadCachedMaps();

  // Load admin data eagerly (async) so it's ready when load() is called
  const adminRoutesPromise = loadAdminRoutes();
  const adminRouteDetailsPromise = loadAdminRouteDetails();

  return {
    name: 'bike-app-build-data',

    // Virtual modules
    resolveId(id: string) {
      if (id === 'virtual:bike-app/cached-maps') return '\0virtual:bike-app/cached-maps';
      if (id === 'virtual:bike-app/admin-routes') return '\0virtual:bike-app/admin-routes';
      if (id === 'virtual:bike-app/admin-route-detail') return '\0virtual:bike-app/admin-route-detail';
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
