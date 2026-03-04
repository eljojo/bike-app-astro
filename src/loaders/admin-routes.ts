import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { cityDir } from '../lib/config';
import { parseGpx } from '../lib/gpx';
import { scoreRoute } from '../lib/difficulty';
import type { AdminRoute, AdminRouteDetail, AdminMediaItem, AdminVariant } from '../types/admin';

const CITY_DIR = cityDir;

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

  // TODO(C7): include all media types when video management is added to admin UI
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
      mediaCount: photos.length,
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
      status: frontmatter.status as string,
      body: body.trim(),
      media: photos,
      contentHash,
      variants: (frontmatter.variants as AdminVariant[]) || [],
    };
  }

  return details;
}
