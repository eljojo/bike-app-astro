import type { AstroIntegration } from 'astro';
import { translatePath } from '../lib/path-translations';
import { isBlogInstance } from '../lib/city-config';

/** Pages shared between both wiki and blog instance types. */
const sharedPages = [
  { pattern: '/', entrypoint: './src/views/index.astro' },
  { pattern: '/about', entrypoint: './src/views/about.astro' },
];

/** Wiki-only pages. */
const wikiPages = [
  { pattern: '/calendar', entrypoint: './src/views/calendar.astro' },
  { pattern: '/map', entrypoint: './src/views/map.astro' },
  { pattern: '/routes', entrypoint: './src/views/routes/index.astro' },
  { pattern: '/routes/[slug]', entrypoint: './src/views/routes/detail.astro' },
  { pattern: '/routes/[slug]/map', entrypoint: './src/views/routes/map.astro' },
  { pattern: '/routes/[slug]/map/[variant]', entrypoint: './src/views/routes/map-variant.astro' },
  { pattern: '/guides', entrypoint: './src/views/guides/index.astro' },
  { pattern: '/guides/[slug]', entrypoint: './src/views/guides/detail.astro' },
  { pattern: '/videos', entrypoint: './src/views/videos/index.astro' },
  { pattern: '/videos/[handle]', entrypoint: './src/views/videos/detail.astro' },
];

/** Blog-only pages. */
const blogPages = [
  { pattern: '/rides', entrypoint: './src/views/rides/index.astro' },
  { pattern: '/rides/[slug]', entrypoint: './src/views/rides/detail.astro' },
  { pattern: '/rides/[slug]/map', entrypoint: './src/views/rides/map.astro' },
  { pattern: '/tours', entrypoint: './src/views/tours/index.astro' },
  { pattern: '/tours/[slug]', entrypoint: './src/views/tours/detail.astro' },
  { pattern: '/stats', entrypoint: './src/views/stats.astro' },
];

/** Routes that don't need locale variants (downloads, feeds, etc.). */
const wikiStaticRoutes = [
  { pattern: '/routes/[slug]/[variant].gpx', entrypoint: './src/views/routes/download-gpx.ts' },
];

const blogStaticRoutes = [
  { pattern: '/rides/[slug]/[variant].gpx', entrypoint: './src/views/rides/download-gpx.ts' },
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
