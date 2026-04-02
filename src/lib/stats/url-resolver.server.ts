import type { ContentIdentity } from './types';
import { reverseTranslatePath } from '../i18n/path-translations';

/** Known content path prefixes and their content types. */
const CONTENT_PREFIXES: Array<{ prefix: string; contentType: ContentIdentity['contentType'] }> = [
  { prefix: 'routes', contentType: 'route' },
  { prefix: 'events', contentType: 'event' },
  { prefix: 'communities', contentType: 'organizer' },
  { prefix: 'bike-paths', contentType: 'bike-path' },
];

/** Non-content path prefixes to skip entirely (not content pages). */
const SKIP_PREFIXES = ['admin', 'api', 'about', 'map', 'calendar', 'feeds', '_'];

/** Content types excluded from v1 tracking — logged during sync for visibility. */
const EXCLUDED_CONTENT_PREFIXES = ['guides', 'tours'];

/**
 * Resolve a URL path to a content identity.
 *
 * @param path - URL path with locale prefix already stripped (e.g., '/routes/britannia')
 * @param locale - Detected locale (for reverse-translating path segments)
 * @param slugAliases - Map of translated slugs to canonical slugs
 * @param redirects - Map of old slugs to current slugs (from redirects.yml)
 * @param videoRouteMap - Map of video handle → route slug (from media.yml)
 * @returns ContentIdentity or null if not a content page
 */
export function resolveUrl(
  path: string,
  locale: string,
  slugAliases: Record<string, string>,
  redirects: Record<string, string>,
  videoRouteMap?: Record<string, string>,
): ContentIdentity | null {
  const cleaned = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;
  const translated = reverseTranslatePath(cleaned, locale);
  const segments = translated.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  const topSegment = segments[0];

  if (SKIP_PREFIXES.includes(topSegment)) return null;
  if (EXCLUDED_CONTENT_PREFIXES.includes(topSegment)) return null;

  // Videos: attribute to the owning route via videoRouteMap
  if (topSegment === 'videos' && segments.length >= 2 && videoRouteMap) {
    const videoHandle = segments[1];
    const routeSlug = videoRouteMap[videoHandle];
    if (routeSlug) {
      return { contentType: 'route', contentSlug: routeSlug, pageType: 'detail' };
    }
    return null; // video not attached to any route
  }
  if (topSegment === 'videos') return null; // no map available

  for (const { prefix, contentType } of CONTENT_PREFIXES) {
    if (topSegment !== prefix) continue;
    if (segments.length < 2) return null;

    if (contentType === 'event') {
      if (segments.length < 3) return null;
      const eventSlug = `${segments[1]}/${segments[2]}`;
      const pageType = (segments.length >= 4 && segments[3] === 'map') ? 'map' : 'detail';
      return { contentType, contentSlug: eventSlug, pageType };
    }

    let slug = segments[1];
    if (slugAliases[slug]) slug = slugAliases[slug];
    if (redirects[slug]) slug = redirects[slug];

    let pageType = 'detail';
    if (segments.length >= 3 && segments[2] === 'map') {
      pageType = segments.length >= 4 ? `map:${segments[3]}` : 'map';
    }

    if (segments.length >= 3 && segments[segments.length - 1].endsWith('.gpx')) return null;

    return { contentType, contentSlug: slug, pageType };
  }

  return null;
}

/**
 * Detect locale from a full URL path and return the locale + path without prefix.
 */
export function detectLocale(
  fullPath: string,
  supportedLocales: string[],
  defaultLocale: string,
): [string, string] {
  const segments = fullPath.split('/').filter(Boolean);
  if (segments.length > 0 && supportedLocales.includes(segments[0]) && segments[0] !== defaultLocale) {
    return [segments[0], '/' + segments.slice(1).join('/')];
  }
  return [defaultLocale, fullPath];
}

/**
 * Build a slug alias map from route content data.
 * Maps locale-specific slugs to canonical slugs.
 */
export function buildSlugAliasMap(
  routes: Array<{ slug: string; translations?: Record<string, { slug?: string }> }>,
): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const route of routes) {
    if (!route.translations) continue;
    for (const locale of Object.keys(route.translations)) {
      const translatedSlug = route.translations[locale]?.slug;
      if (translatedSlug && translatedSlug !== route.slug) {
        aliases[translatedSlug] = route.slug;
      }
    }
  }
  return aliases;
}
