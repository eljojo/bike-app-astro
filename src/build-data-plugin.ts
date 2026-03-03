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
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import type { Plugin } from 'vite';
import { CONTENT_DIR, CITY, cityDir } from './lib/config';
import { parseGpx } from './lib/gpx';
import { scoreRoute } from './lib/difficulty';

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

interface AdminOrganizerRef {
  name: string;
  website?: string;
  instagram?: string;
}

interface AdminEvent {
  id: string;           // e.g. "2025/bike-fest"
  slug: string;         // e.g. "bike-fest"
  year: string;         // e.g. "2025"
  name: string;
  start_date: string;
  end_date?: string;
  organizer?: string | AdminOrganizerRef;  // slug string or inline object
  poster_key?: string;
  contentHash: string;
}

interface AdminEventDetail {
  id: string;
  slug: string;
  year: string;
  name: string;
  start_date: string;
  start_time?: string;
  end_date?: string;
  end_time?: string;
  registration_url?: string;
  distances?: string;
  location?: string;
  review_url?: string;
  organizer?: string | AdminOrganizerRef;  // slug string or inline object
  poster_key?: string;
  poster_content_type?: string;
  body: string;
  contentHash: string;
}

interface AdminOrganizer {
  slug: string;
  name: string;
  website?: string;
  instagram?: string;
}

interface AdminRoute {
  slug: string;
  name: string;
  photoCount: number;
  status: string;
  contentHash: string;
  difficultyScore: number | null;
}

interface AdminMediaItem {
  key: string;
  caption?: string;
  cover?: boolean;
}

interface AdminVariant {
  name: string;
  gpx: string;
  distance_km?: number;
  strava_url?: string;
  rwgps_url?: string;
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
  contentHash: string;
  variants: AdminVariant[];
}

function readRouteDir(slug: string) {
  const routeDir = path.join(CITY_DIR, 'routes', slug);
  const mdPath = path.join(routeDir, 'index.md');
  const mediaPath = path.join(routeDir, 'media.yml');

  const indexRaw = fs.readFileSync(mdPath, 'utf-8');
  const mediaRaw = fs.existsSync(mediaPath) ? fs.readFileSync(mediaPath, 'utf-8') : '';
  const contentHash = createHash('md5').update(indexRaw).update(mediaRaw).digest('hex');

  const { data: frontmatter, content: body } = matter(indexRaw);

  const rawMedia = mediaRaw
    ? (yaml.load(mediaRaw) as Array<Record<string, unknown>>) || []
    : [];

  const photos: AdminMediaItem[] = rawMedia
    .filter((m) => m.type === 'photo')
    .map((m) => {
      const item: AdminMediaItem = { key: m.key as string };
      if (m.caption != null) item.caption = m.caption as string;
      if (m.cover != null) item.cover = m.cover as boolean;
      return item;
    });

  return { frontmatter, body, photos, contentHash };
}

export async function loadAdminRoutes(): Promise<AdminRoute[]> {
  const routesDir = path.join(CITY_DIR, 'routes');
  const slugs = fs.readdirSync(routesDir).filter((name) => {
    return fs.statSync(path.join(routesDir, name)).isDirectory();
  });

  const routes: AdminRoute[] = slugs.map((slug) => {
    const { frontmatter, photos, contentHash } = readRouteDir(slug);
    const routeDir = path.join(routesDir, slug);

    // Parse GPX files to compute difficulty score
    const variants = (frontmatter.variants as Array<{ gpx: string; distance_km?: number }>) || [];
    const gpxTracks: Record<string, { elevation_gain_m: number; max_gradient_pct: number; points: { ele: number }[] }> = {};
    for (const v of variants) {
      const gpxPath = path.join(routeDir, v.gpx);
      if (fs.existsSync(gpxPath)) {
        try {
          const parsed = parseGpx(fs.readFileSync(gpxPath, 'utf-8'));
          gpxTracks[v.gpx] = parsed;
        } catch { /* skip unparseable GPX */ }
      }
    }

    const scores = scoreRoute({
      data: {
        distance_km: (frontmatter.distance_km as number) || 0,
        tags: (frontmatter.tags as string[]) || [],
        variants,
        gpxTracks,
      },
    });

    return {
      slug,
      name: frontmatter.name as string,
      photoCount: photos.length,
      status: frontmatter.status as string,
      contentHash,
      difficultyScore: scores.length > 0 ? Math.min(...scores) : null,
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
    const { frontmatter, body, photos, contentHash } = readRouteDir(slug);
    details[slug] = {
      slug,
      name: frontmatter.name as string,
      tagline: (frontmatter.tagline as string) || '',
      tags: (frontmatter.tags as string[]) || [],
      distance: (frontmatter.distance_km as number) || 0,
      status: frontmatter.status as string,
      body: body.trim(),
      media: photos,
      contentHash,
      variants: (frontmatter.variants as AdminVariant[]) || [],
    };
  }

  return details;
}

export async function loadAdminEvents(): Promise<AdminEvent[]> {
  const eventsDir = path.join(CITY_DIR, 'events');
  if (!fs.existsSync(eventsDir)) return [];

  const events: AdminEvent[] = [];

  for (const yearDir of fs.readdirSync(eventsDir).sort().reverse()) {
    const yearPath = path.join(eventsDir, yearDir);
    if (!fs.statSync(yearPath).isDirectory()) continue;

    for (const file of fs.readdirSync(yearPath)) {
      if (!file.endsWith('.md')) continue;
      // Skip translation files like event.fr.md
      const parts = file.replace('.md', '').split('.');
      if (parts.length > 1) continue;

      const slug = file.replace('.md', '');
      const filePath = path.join(yearPath, file);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const contentHash = createHash('md5').update(raw).digest('hex');
      const { data: fm } = matter(raw);

      events.push({
        id: `${yearDir}/${slug}`,
        slug,
        year: yearDir,
        name: fm.name as string,
        start_date: fm.start_date as string,
        end_date: fm.end_date as string | undefined,
        organizer: fm.organizer as string | AdminOrganizerRef | undefined,
        poster_key: fm.poster_key as string | undefined,
        contentHash,
      });
    }
  }

  // Sort by start_date descending (newest first)
  events.sort((a, b) => b.start_date.localeCompare(a.start_date));
  return events;
}

export async function loadAdminEventDetails(): Promise<Record<string, AdminEventDetail>> {
  const eventsDir = path.join(CITY_DIR, 'events');
  if (!fs.existsSync(eventsDir)) return {};

  const details: Record<string, AdminEventDetail> = {};

  for (const yearDir of fs.readdirSync(eventsDir)) {
    const yearPath = path.join(eventsDir, yearDir);
    if (!fs.statSync(yearPath).isDirectory()) continue;

    for (const file of fs.readdirSync(yearPath)) {
      if (!file.endsWith('.md')) continue;
      const parts = file.replace('.md', '').split('.');
      if (parts.length > 1) continue;

      const slug = file.replace('.md', '');
      const id = `${yearDir}/${slug}`;
      const filePath = path.join(yearPath, file);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const contentHash = createHash('md5').update(raw).digest('hex');
      const { data: fm, content: body } = matter(raw);

      details[id] = {
        id,
        slug,
        year: yearDir,
        name: fm.name as string,
        start_date: fm.start_date as string,
        start_time: fm.start_time as string | undefined,
        end_date: fm.end_date as string | undefined,
        end_time: fm.end_time as string | undefined,
        registration_url: fm.registration_url as string | undefined,
        distances: fm.distances as string | undefined,
        location: fm.location as string | undefined,
        review_url: fm.review_url as string | undefined,
        organizer: fm.organizer as string | AdminOrganizerRef | undefined,
        poster_key: fm.poster_key as string | undefined,
        poster_content_type: fm.poster_content_type as string | undefined,
        body: body.trim(),
        contentHash,
      };
    }
  }

  return details;
}

export async function loadAdminOrganizers(): Promise<AdminOrganizer[]> {
  const orgDir = path.join(CITY_DIR, 'organizers');
  if (!fs.existsSync(orgDir)) return [];

  const organizers: AdminOrganizer[] = [];

  for (const file of fs.readdirSync(orgDir)) {
    if (!file.endsWith('.md')) continue;
    const parts = file.replace('.md', '').split('.');
    if (parts.length > 1) continue;

    const slug = file.replace('.md', '');
    const raw = fs.readFileSync(path.join(orgDir, file), 'utf-8');
    const { data: fm } = matter(raw);

    organizers.push({
      slug,
      name: fm.name as string,
      website: fm.website as string | undefined,
      instagram: fm.instagram as string | undefined,
    });
  }

  organizers.sort((a, b) => a.name.localeCompare(b.name));
  return organizers;
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
