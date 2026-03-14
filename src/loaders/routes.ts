// routes.ts — Public content collection loader for routes.
//
// Reads route directories via route-file-reader.ts (shared I/O layer),
// then applies incremental caching, renders markdown, and stores entries
// in Astro's content collection for static page generation.
//
// Data flow:
//   route-file-reader.ts → routes.ts → Astro content collection → static pages

import type { Loader } from 'astro/loaders';
import path from 'node:path';
import fs from 'node:fs';
import { cityDir } from '../lib/config/config';
import { computeDirectoryDigest } from '../lib/directory-digest';
import { renderMarkdownHtml } from '../lib/markdown/markdown-render';
import { loadLocaleTranslations } from './locale-content';
import { supportedLocales, defaultLocale } from '../lib/locale-utils';
import { readRouteDir } from './route-file-reader';

/** Re-export RouteMedia — other modules import it from here. */
export type { RouteMedia } from './route-file-reader';

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

        // Incremental caching: skip unchanged routes
        const digest = computeDirectoryDigest(routeDir, { includeSubdirs: ['variants'] });
        const lastDigest = meta.get(`route:${slug}:digest`);
        if (lastDigest === digest) {
          logger.info(`Skipping unchanged route: ${slug}`);
          skipped++;
          continue;
        }

        const parsed = readRouteDir(routeDir, slug);
        if (!parsed) continue;

        const renderedBody = await renderMarkdownHtml(parsed.body);

        const nonDefaultLocales = supportedLocales().filter(l => l !== defaultLocale());
        const translations = await loadLocaleTranslations(routeDir, nonDefaultLocales);

        store.set({
          id: slug,
          data: {
            ...parsed.frontmatter,
            media: parsed.media,
            gpxTracks: parsed.gpxTracks,
            renderedBody,
            translations,
          },
          body: parsed.body,
          digest,
        });
        meta.set(`route:${slug}:digest`, digest);
      }

      logger.info(`Loaded ${slugs.length} routes (${skipped} unchanged, skipped)`);
    },
  };
}
