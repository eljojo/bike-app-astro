import type { AstroIntegration } from 'astro';
import { translatePath, buildSegmentTranslations, setSegmentTranslations } from '../lib/path-translations';
import type { LocalePageWithSegments } from '../lib/path-translations';
import { isBlogInstance, isClubInstance } from '../lib/city-config';

/** Resolve a view path relative to this file's location (works from node_modules too). */
const view = (rel: string) => new URL(`../views/${rel}`, import.meta.url).pathname;

/** Pages shared between both wiki and blog instance types. */
const sharedPages: LocalePageWithSegments[] = [
  { pattern: '/', entrypoint: view('index.astro') },
  { pattern: '/about', entrypoint: view('about.astro'), segments: { about: { fr: 'a-propos', es: 'acerca-de' } } },
];

/** Wiki-only pages. */
const wikiPages: LocalePageWithSegments[] = [
  { pattern: '/calendar', entrypoint: view('calendar.astro'), segments: { calendar: { fr: 'calendrier', es: 'calendario' } } },
  { pattern: '/events/[...slug]', entrypoint: view('events/club-detail.astro'), segments: { events: { fr: 'evenements', es: 'eventos' } } },
  { pattern: '/map', entrypoint: view('map.astro'), segments: { map: { fr: 'carte', es: 'mapa' } } },
  { pattern: '/routes', entrypoint: view('routes/index.astro'), segments: { routes: { fr: 'parcours', es: 'rutas' } } },
  { pattern: '/routes/[slug]', entrypoint: view('routes/detail.astro') },
  { pattern: '/routes/[slug]/map', entrypoint: view('routes/map.astro') },
  { pattern: '/routes/[slug]/map/[variant]', entrypoint: view('routes/map-variant.astro') },
  { pattern: '/guides', entrypoint: view('guides/index.astro') },
  { pattern: '/guides/[slug]', entrypoint: view('guides/detail.astro') },
  { pattern: '/videos', entrypoint: view('videos/index.astro') },
  { pattern: '/videos/[handle]', entrypoint: view('videos/detail.astro') },
];

/** Blog-only pages. */
const blogPages: LocalePageWithSegments[] = [
  { pattern: '/rides', entrypoint: view('rides/index.astro'), segments: { rides: { fr: 'sorties', es: 'recorridos' } } },
  { pattern: '/rides/[slug]', entrypoint: view('rides/detail.astro') },
  { pattern: '/rides/[slug]/map', entrypoint: view('rides/map.astro') },
  { pattern: '/tours', entrypoint: view('tours/index.astro'), segments: { tours: { fr: 'voyages', es: 'viajes' } } },
  { pattern: '/tours/[slug]', entrypoint: view('tours/detail.astro') },
  { pattern: '/tours/[tourSlug]/[rideSlug]', entrypoint: view('tours/ride-detail.astro') },
  { pattern: '/tours/[tourSlug]/[rideSlug]/map', entrypoint: view('tours/ride-map.astro') },
  { pattern: '/stats', entrypoint: view('stats.astro'), segments: { stats: { fr: 'statistiques', es: 'estadisticas' } } },
];

/** Routes that don't need locale variants (downloads, feeds, etc.). */
const wikiStaticRoutes = [
  { pattern: '/routes/[slug]/[variant].gpx', entrypoint: view('routes/download-gpx.ts') },
];

const blogStaticRoutes = [
  { pattern: '/rides/[slug]/[variant].gpx', entrypoint: view('rides/download-gpx.ts') },
];

/** Club-only pages (randonneuring clubs, cycling organizations). */
const clubPages: LocalePageWithSegments[] = [
  { pattern: '/events', entrypoint: view('events/index.astro'), segments: { events: { fr: 'evenements', es: 'eventos' } } },
  { pattern: '/events/[...slug]', entrypoint: view('events/club-detail.astro') },
  { pattern: '/routes/[slug]', entrypoint: view('routes/detail.astro'), segments: { routes: { fr: 'parcours', es: 'rutas' } } },
  { pattern: '/routes/[slug]/map', entrypoint: view('routes/map.astro') },
  { pattern: '/places', entrypoint: view('places/index.astro'), segments: { places: { fr: 'lieux', es: 'lugares' } } },
];

const clubStaticRoutes = [
  ...wikiStaticRoutes,
  { pattern: '/events/[...path].gpx', entrypoint: view('events/download-gpx.ts') },
];

export function i18nRoutes(): AstroIntegration {
  return {
    name: 'i18n-routes',
    hooks: {
      'astro:config:setup': ({ injectRoute, config }) => {
        const locales = (config.i18n?.locales || ['en']) as string[];
        const defaultLocale = config.i18n?.defaultLocale || 'en';
        const blog = isBlogInstance();
        const club = isClubInstance();

        const localePages = [
          ...sharedPages,
          ...(blog ? blogPages : club ? clubPages : wikiPages),
        ];

        // Build and set segment translations from colocated route definitions
        const translations = buildSegmentTranslations(localePages);
        setSegmentTranslations(translations);

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
        const staticRoutes = blog ? blogStaticRoutes : club ? clubStaticRoutes : wikiStaticRoutes;
        for (const page of staticRoutes) {
          injectRoute({ pattern: page.pattern, entrypoint: page.entrypoint });
        }
      },
    },
  };
}
