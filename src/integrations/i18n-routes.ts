import type { AstroIntegration } from 'astro';
import { translatePath } from '../lib/path-translations';
import { isBlogInstance } from '../lib/city-config';

/** Resolve a view path relative to this file's location (works from node_modules too). */
const view = (rel: string) => new URL(`../views/${rel}`, import.meta.url).pathname;

/** Pages shared between both wiki and blog instance types. */
const sharedPages = [
  { pattern: '/', entrypoint: view('index.astro') },
  { pattern: '/about', entrypoint: view('about.astro') },
];

/** Wiki-only pages. */
const wikiPages = [
  { pattern: '/calendar', entrypoint: view('calendar.astro') },
  { pattern: '/map', entrypoint: view('map.astro') },
  { pattern: '/routes', entrypoint: view('routes/index.astro') },
  { pattern: '/routes/[slug]', entrypoint: view('routes/detail.astro') },
  { pattern: '/routes/[slug]/map', entrypoint: view('routes/map.astro') },
  { pattern: '/routes/[slug]/map/[variant]', entrypoint: view('routes/map-variant.astro') },
  { pattern: '/guides', entrypoint: view('guides/index.astro') },
  { pattern: '/guides/[slug]', entrypoint: view('guides/detail.astro') },
  { pattern: '/videos', entrypoint: view('videos/index.astro') },
  { pattern: '/videos/[handle]', entrypoint: view('videos/detail.astro') },
];

/** Blog-only pages. */
const blogPages = [
  { pattern: '/rides', entrypoint: view('rides/index.astro') },
  { pattern: '/rides/[slug]', entrypoint: view('rides/detail.astro') },
  { pattern: '/rides/[slug]/map', entrypoint: view('rides/map.astro') },
  { pattern: '/tours', entrypoint: view('tours/index.astro') },
  { pattern: '/tours/[slug]', entrypoint: view('tours/detail.astro') },
  { pattern: '/stats', entrypoint: view('stats.astro') },
];

/** Routes that don't need locale variants (downloads, feeds, etc.). */
const wikiStaticRoutes = [
  { pattern: '/routes/[slug]/[variant].gpx', entrypoint: view('routes/download-gpx.ts') },
];

const blogStaticRoutes = [
  { pattern: '/rides/[slug]/[variant].gpx', entrypoint: view('rides/download-gpx.ts') },
];

export function i18nRoutes(): AstroIntegration {
  return {
    name: 'i18n-routes',
    hooks: {
      'astro:config:setup': ({ injectRoute, config }) => {
        const locales = (config.i18n?.locales || ['en']) as string[];
        const defaultLocale = config.i18n?.defaultLocale || 'en';
        const blog = isBlogInstance();

        const localePages = [
          ...sharedPages,
          ...(blog ? blogPages : wikiPages),
        ];

        for (const page of localePages) {
          // Default locale: routes at root (no prefix)
          injectRoute({ pattern: page.pattern, entrypoint: page.entrypoint });

          // Non-default locales: routes with /{locale} prefix
          for (const locale of locales) {
            if (locale === defaultLocale) continue;
            const translatedPattern = translatePath(page.pattern, locale);
            injectRoute({
              pattern: `/${locale}${translatedPattern}`,
              entrypoint: page.entrypoint,
            });
          }
        }

        // Static routes (no locale variants needed)
        const staticRoutes = blog ? blogStaticRoutes : wikiStaticRoutes;
        for (const page of staticRoutes) {
          injectRoute({ pattern: page.pattern, entrypoint: page.entrypoint });
        }
      },
    },
  };
}
