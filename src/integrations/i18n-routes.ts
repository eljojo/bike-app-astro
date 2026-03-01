import type { AstroIntegration } from 'astro';
import { translatePath } from '../lib/path-translations';

/** Pages that get locale-prefixed copies for each non-default locale. */
const localePages = [
  { pattern: '/', entrypoint: './src/views/index.astro' },
  { pattern: '/about', entrypoint: './src/views/about.astro' },
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

/** Routes that don't need locale variants (downloads, feeds, etc.). */
const staticRoutes = [
  { pattern: '/routes/[slug]/[variant].gpx', entrypoint: './src/views/routes/download-gpx.ts' },
];

export function i18nRoutes(): AstroIntegration {
  return {
    name: 'i18n-routes',
    hooks: {
      'astro:config:setup': ({ injectRoute, config }) => {
        const locales = (config.i18n?.locales || ['en']) as string[];
        const defaultLocale = config.i18n?.defaultLocale || 'en';

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
        for (const page of staticRoutes) {
          injectRoute({ pattern: page.pattern, entrypoint: page.entrypoint });
        }
      },
    },
  };
}
