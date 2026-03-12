import type { Loader } from 'astro/loaders';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { parseGpx, type GpxTrack } from '../lib/gpx';
import { cityDir } from '../lib/config';
import { computeDirectoryDigest } from '../lib/directory-digest';
import { renderMarkdownHtml } from '../lib/markdown-render';
import { loadLocaleTranslations } from './locale-content';
import { supportedLocales, defaultLocale } from '../lib/locale-utils';

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
  lat?: number;
  lng?: number;
  uploaded_by?: string;
  captured_at?: string;
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
        const digest = computeDirectoryDigest(routeDir, { includeSubdirs: ['variants'] });
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

        const renderedBody = await renderMarkdownHtml(body);

        const nonDefaultLocales = supportedLocales().filter(l => l !== defaultLocale());
        const translations = await loadLocaleTranslations(routeDir, nonDefaultLocales);

        store.set({
          id: slug,
          data: { ...frontmatter, media, gpxTracks, renderedBody, translations },
          body,
          digest,
        });
        meta.set(`route:${slug}:digest`, digest);
      }

      logger.info(`Loaded ${slugs.length} routes (${skipped} unchanged, skipped)`);
    },
  };
}
