// admin-routes.ts — Admin virtual module loader for routes.
//
// Reads route directories via route-file-reader.ts (shared I/O layer),
// then computes content hashes, difficulty scores, and admin list shapes
// for the virtual module system.
//
// Data flow:
//   route-file-reader.ts → admin-routes.ts → build-data-plugin.ts
//     → virtual:bike-app/admin-routes (list)
//     → virtual:bike-app/admin-route-detail (details)

import fs from 'node:fs';
import path from 'node:path';
import { cityDir } from '../lib/config';
import { scoreRoute } from '../lib/difficulty';
import type { AdminRoute } from '../types/admin';
import { routeDetailFromGit, computeRouteContentHash, type RouteDetail } from '../lib/models/route-model';
import { supportedLocales, defaultLocale } from '../lib/locale-utils';
import { readRouteDir } from './route-file-reader';

interface AdminRouteData {
  routes: AdminRoute[];
  details: Record<string, RouteDetail & { contentHash: string }>;
}

let cachedRouteData: AdminRouteData | null = null;

export async function loadAdminRouteData(): Promise<AdminRouteData> {
  if (cachedRouteData) return cachedRouteData;

  const routesDir = path.join(cityDir, 'routes');
  if (!fs.existsSync(routesDir)) {
    cachedRouteData = { routes: [], details: {} };
    return cachedRouteData;
  }
  const slugs = fs.readdirSync(routesDir).filter((name) => {
    return fs.statSync(path.join(routesDir, name)).isDirectory();
  });

  const nonDefaultLocales = supportedLocales().filter(l => l !== defaultLocale());
  const routes: AdminRoute[] = [];
  const details: Record<string, RouteDetail & { contentHash: string }> = {};

  for (const slug of slugs) {
    const routeDir = path.join(routesDir, slug);
    const parsed = readRouteDir(routeDir, slug, nonDefaultLocales);
    if (!parsed) continue;

    // Compute content hash from raw file contents
    // Read raw translation files for hashing (the reader parsed them,
    // but the hash function needs the original raw strings)
    const translationContents = Object.keys(parsed.translations).length > 0
      ? Object.fromEntries(
          nonDefaultLocales
            .filter(locale => parsed.translations[locale])
            .map(locale => {
              const localePath = path.join(routeDir, `index.${locale}.md`);
              return [locale, fs.readFileSync(localePath, 'utf-8')];
            })
        )
      : undefined;

    const contentHash = computeRouteContentHash(
      parsed.rawContents.indexMd,
      parsed.rawContents.mediaYml,
      translationContents,
    );

    // Build admin translations shape from parsed data
    const adminTranslations: Record<string, { name?: string; tagline?: string; body?: string }> = {};
    for (const [locale, t] of Object.entries(parsed.translations)) {
      adminTranslations[locale] = {
        name: t.frontmatter.name as string | undefined,
        tagline: t.frontmatter.tagline as string | undefined,
        body: t.body || undefined,
      };
    }

    const detail = routeDetailFromGit(
      slug,
      parsed.frontmatter,
      parsed.body,
      parsed.rawContents.mediaYml,
      adminTranslations,
    );

    // Compute difficulty score from parsed GPX tracks
    const variants = (parsed.frontmatter.variants as Array<{ gpx: string; distance_km?: number }>) || [];
    const scores = scoreRoute({
      data: {
        distance_km: (parsed.frontmatter.distance_km as number) || 0,
        tags: (parsed.frontmatter.tags as string[]) || [],
        variants,
        gpxTracks: parsed.gpxTracks,
      },
    });

    const coverItem = detail.media.find(m => m.cover) || detail.media[0];
    routes.push({
      slug,
      name: parsed.frontmatter.name as string,
      mediaCount: detail.media.length,
      status: parsed.frontmatter.status as string,
      contentHash,
      difficultyScore: scores.length > 0 ? Math.min(...scores) : null,
      coverKey: coverItem?.key,
    });

    details[slug] = { ...detail, contentHash };
  }

  routes.sort((a, b) => a.name.localeCompare(b.name));
  cachedRouteData = { routes, details };
  return cachedRouteData;
}

export function loadRouteTrackPoints(): Record<string, Array<{ lat: number; lng: number }>> {
  const routesDir = path.join(cityDir, 'routes');
  if (!fs.existsSync(routesDir)) return {};
  const slugs = fs.readdirSync(routesDir).filter((name) => {
    return fs.statSync(path.join(routesDir, name)).isDirectory();
  });

  const tracks: Record<string, Array<{ lat: number; lng: number }>> = {};

  for (const slug of slugs) {
    const routeDir = path.join(routesDir, slug);
    const parsed = readRouteDir(routeDir, slug);
    if (!parsed) continue;

    const points: Array<{ lat: number; lng: number }> = [];
    for (const track of Object.values(parsed.gpxTracks)) {
      for (const p of track.points) {
        points.push({ lat: p.lat, lng: p.lon });
      }
    }

    if (points.length > 0) {
      tracks[slug] = points;
    }
  }

  return tracks;
}
