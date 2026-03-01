import type { Loader } from 'astro/loaders';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { marked } from 'marked';
import { parseGpx } from '../lib/gpx';
import { cityDir } from '../lib/config';

export function routeLoader(): Loader {
  return {
    name: 'route-loader',
    load: async ({ store, logger }) => {
      const routesDir = path.join(cityDir, 'routes');
      if (!fs.existsSync(routesDir)) {
        logger.warn(`Routes directory not found: ${routesDir}`);
        return;
      }

      const slugs = fs.readdirSync(routesDir).filter(f =>
        fs.statSync(path.join(routesDir, f)).isDirectory()
      );

      for (const slug of slugs) {
        const routeDir = path.join(routesDir, slug);
        const indexPath = path.join(routeDir, 'index.md');
        if (!fs.existsSync(indexPath)) continue;

        const raw = fs.readFileSync(indexPath, 'utf-8');
        const { data: frontmatter, content: body } = matter(raw);

        // Load media.yml
        const mediaPath = path.join(routeDir, 'media.yml');
        let media: any[] = [];
        if (fs.existsSync(mediaPath)) {
          const mediaRaw = fs.readFileSync(mediaPath, 'utf-8');
          media = (yaml.load(mediaRaw) as any[]) || [];
        }

        // Parse GPX files from variants
        const gpxTracks: Record<string, any> = {};
        const variants = frontmatter.variants || [];
        for (const variant of variants) {
          const gpxPath = path.join(routeDir, variant.gpx);
          if (fs.existsSync(gpxPath)) {
            try {
              const gpxXml = fs.readFileSync(gpxPath, 'utf-8');
              gpxTracks[variant.gpx] = parseGpx(gpxXml);
            } catch (e: any) {
              logger.warn(`Failed to parse GPX ${gpxPath}: ${e.message}`);
            }
          }
        }

        const renderedBody = await marked.parse(body);
        store.set({
          id: slug,
          data: { ...frontmatter, media, gpxTracks, renderedBody },
          body,
        });
      }

      logger.info(`Loaded ${slugs.length} routes`);
    },
  };
}
