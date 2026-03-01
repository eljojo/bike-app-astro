import type { Loader } from 'astro/loaders';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { marked } from 'marked';
import { parseGpx, type GpxTrack } from '../lib/gpx';
import { cityDir } from '../lib/config';

/** A media entry (photo or video) attached to a route. */
export interface RouteMedia {
  type: 'photo' | 'video';
  key: string;
  handle: string;
  cover?: boolean;
  caption?: string;
  title?: string;
  score?: number;
  width?: number;
  height?: number;
  duration?: string;
  orientation?: string;
}

/**
 * Compute an MD5 digest of a route directory based on file mtimes.
 * Includes top-level files and any files in the variants/ subdirectory.
 */
function computeRouteDigest(routeDir: string): string {
  const hash = createHash('md5');

  // Hash top-level files by their mtimes
  for (const file of fs.readdirSync(routeDir)) {
    const filePath = path.join(routeDir, file);
    const stat = fs.statSync(filePath);
    if (stat.isFile()) {
      hash.update(`${file}:${stat.mtimeMs}`);
    }
  }

  // Hash variant files
  const variantsDir = path.join(routeDir, 'variants');
  if (fs.existsSync(variantsDir)) {
    for (const file of fs.readdirSync(variantsDir)) {
      const filePath = path.join(variantsDir, file);
      const stat = fs.statSync(filePath);
      if (stat.isFile()) {
        hash.update(`variants/${file}:${stat.mtimeMs}`);
      }
    }
  }

  return hash.digest('hex');
}

export function routeLoader(): Loader {
  return {
    name: 'route-loader',
    load: async ({ store, meta, logger }) => {
      const routesDir = path.join(cityDir, 'routes');
      if (!fs.existsSync(routesDir)) {
        logger.warn(`Routes directory not found: ${routesDir}`);
        return;
      }

      const slugs = fs.readdirSync(routesDir).filter(f =>
        fs.statSync(path.join(routesDir, f)).isDirectory()
      );

      let skipped = 0;

      for (const slug of slugs) {
        const routeDir = path.join(routesDir, slug);
        const indexPath = path.join(routeDir, 'index.md');
        if (!fs.existsSync(indexPath)) continue;

        // Incremental caching: skip unchanged routes
        const digest = computeRouteDigest(routeDir);
        const lastDigest = meta.get(`route:${slug}:digest`);
        if (lastDigest === digest) {
          logger.info(`Skipping unchanged route: ${slug}`);
          skipped++;
          continue;
        }

        const raw = fs.readFileSync(indexPath, 'utf-8');
        const { data: frontmatter, content: body } = matter(raw);

        // Load media.yml
        const mediaPath = path.join(routeDir, 'media.yml');
        let media: RouteMedia[] = [];
        if (fs.existsSync(mediaPath)) {
          const mediaRaw = fs.readFileSync(mediaPath, 'utf-8');
          media = (yaml.load(mediaRaw) as RouteMedia[]) || [];
        }

        // Parse GPX files from variants
        const gpxTracks: Record<string, GpxTrack> = {};
        const variants = frontmatter.variants || [];
        for (const variant of variants) {
          const gpxPath = path.join(routeDir, variant.gpx);
          if (fs.existsSync(gpxPath)) {
            try {
              const gpxXml = fs.readFileSync(gpxPath, 'utf-8');
              gpxTracks[variant.gpx] = parseGpx(gpxXml);
            } catch (e: unknown) {
              const message = e instanceof Error ? e.message : String(e);
              logger.warn(`Failed to parse GPX ${gpxPath}: ${message}`);
            }
          }
        }

        const renderedBody = await marked.parse(body);
        store.set({
          id: slug,
          data: { ...frontmatter, media, gpxTracks, renderedBody },
          body,
          digest,
        });
        meta.set(`route:${slug}:digest`, digest);
      }

      logger.info(`Loaded ${slugs.length} routes (${skipped} unchanged, skipped)`);
    },
  };
}
