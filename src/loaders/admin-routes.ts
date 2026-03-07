import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { cityDir } from '../lib/config';
import { parseGpx, type GpxTrack } from '../lib/gpx';
import { scoreRoute } from '../lib/difficulty';
import type { AdminRoute } from '../types/admin';
import { routeDetailFromGit, computeRouteContentHash, type RouteDetail } from '../lib/models/route-model';
import { supportedLocales, defaultLocale } from '../lib/locale-utils';

const CITY_DIR = cityDir;

function readRouteDir(slug: string) {
  const routeDir = path.join(CITY_DIR, 'routes', slug);
  const mdPath = path.join(routeDir, 'index.md');
  const mediaPath = path.join(routeDir, 'media.yml');

  const indexRaw = fs.readFileSync(mdPath, 'utf-8');
  const mediaRaw = fs.existsSync(mediaPath) ? fs.readFileSync(mediaPath, 'utf-8') : '';

  const secondaryLocales = supportedLocales().filter(l => l !== defaultLocale());
  const translationContents: Record<string, string> = {};
  for (const locale of secondaryLocales) {
    const localePath = path.join(routeDir, `index.${locale}.md`);
    if (fs.existsSync(localePath)) {
      translationContents[locale] = fs.readFileSync(localePath, 'utf-8');
    }
  }
  const contentHash = computeRouteContentHash(indexRaw, mediaRaw || undefined, Object.keys(translationContents).length > 0 ? translationContents : undefined);

  const { data: frontmatter, content: body } = matter(indexRaw);

  const translations: Record<string, { name?: string; tagline?: string; body?: string }> = {};
  for (const [locale, raw] of Object.entries(translationContents)) {
    const { data: fm, content: localeBody } = matter(raw);
    translations[locale] = {
      name: fm.name as string | undefined,
      tagline: fm.tagline as string | undefined,
      body: localeBody.trim() || undefined,
    };
  }

  const detail = routeDetailFromGit(slug, frontmatter, body, mediaRaw || undefined, translations);

  return { frontmatter, detail, contentHash };
}

interface AdminRouteData {
  routes: AdminRoute[];
  details: Record<string, RouteDetail & { contentHash: string }>;
}

let cachedRouteData: AdminRouteData | null = null;

export async function loadAdminRouteData(): Promise<AdminRouteData> {
  if (cachedRouteData) return cachedRouteData;

  const routesDir = path.join(CITY_DIR, 'routes');
  const slugs = fs.readdirSync(routesDir).filter((name) => {
    return fs.statSync(path.join(routesDir, name)).isDirectory();
  });

  const routes: AdminRoute[] = [];
  const details: Record<string, RouteDetail & { contentHash: string }> = {};

  for (const slug of slugs) {
    const { frontmatter, detail, contentHash } = readRouteDir(slug);
    const routeDir = path.join(routesDir, slug);

    // Parse GPX files to compute difficulty score
    const variants = (frontmatter.variants as Array<{ gpx: string; distance_km?: number }>) || [];
    const gpxTracks: Record<string, GpxTrack> = {};
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

    routes.push({
      slug,
      name: frontmatter.name as string,
      mediaCount: detail.media.length,
      status: frontmatter.status as string,
      contentHash,
      difficultyScore: scores.length > 0 ? Math.min(...scores) : null,
    });

    details[slug] = { ...detail, contentHash };
  }

  routes.sort((a, b) => a.name.localeCompare(b.name));
  cachedRouteData = { routes, details };
  return cachedRouteData;
}

export function loadRouteTrackPoints(): Record<string, Array<{ lat: number; lng: number }>> {
  const routesDir = path.join(CITY_DIR, 'routes');
  const slugs = fs.readdirSync(routesDir).filter((name) => {
    return fs.statSync(path.join(routesDir, name)).isDirectory();
  });

  const tracks: Record<string, Array<{ lat: number; lng: number }>> = {};

  for (const slug of slugs) {
    const routeDir = path.join(routesDir, slug);
    const { frontmatter } = readRouteDir(slug);
    const variants = (frontmatter.variants as Array<{ gpx: string }>) || [];

    const points: Array<{ lat: number; lng: number }> = [];
    for (const v of variants) {
      const gpxPath = path.join(routeDir, v.gpx);
      if (fs.existsSync(gpxPath)) {
        try {
          const parsed = parseGpx(fs.readFileSync(gpxPath, 'utf-8'));
          for (const p of parsed.points) {
            points.push({ lat: p.lat, lng: p.lon });
          }
        } catch { /* skip unparseable GPX */ }
      }
    }

    if (points.length > 0) {
      tracks[slug] = points;
    }
  }

  return tracks;
}

