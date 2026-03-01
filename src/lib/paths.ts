/** Centralized URL path construction. One place to change if URL patterns evolve. */
import { defaultLocale } from './locale-utils';
import { translatePath } from './path-translations';

/** When a locale is provided and differs from the default, translate path segments and add locale prefix. */
function localize(path: string, locale?: string): string {
  if (!locale || locale === defaultLocale()) return path;
  const translated = translatePath(path, locale);
  return `/${locale}${translated}`;
}

// Page paths
export const paths = {
  route: (slug: string, locale?: string) => localize(`/routes/${slug}`, locale),
  routeMap: (slug: string, locale?: string) => localize(`/routes/${slug}/map`, locale),
  routeVariantMap: (slug: string, variant: string, locale?: string) => localize(`/routes/${slug}/map/${variant}`, locale),
  routeGpx: (slug: string, variant: string) => `/routes/${slug}/${variant}.gpx`,  // GPX never localized
  guide: (slug: string, locale?: string) => localize(`/guides/${slug}`, locale),
  video: (handle: string, locale?: string) => localize(`/videos/${handle}`, locale),
};

/** Get the correct slug for a route in the given locale. Uses translated slug if available. */
export function routeSlug(route: { id: string; data: { translations?: Record<string, { slug?: string }> } }, locale: string | undefined): string {
  if (locale && locale !== defaultLocale()) {
    const slug = route.data.translations?.[locale]?.slug;
    if (slug) return slug;
  }
  return route.id;
}

// Static asset paths (map thumbnails)
export const assets = {
  mapThumbnail: (slug: string, size: 375 | 750 = 750) => `/maps/${slug}/map-${size}.webp`,
  mapThumbnailSrcset: (slug: string) => `/maps/${slug}/map-375.webp 1x, /maps/${slug}/map-750.webp 2x`,
  mapVariantThumbnail: (slug: string, variant: string, size: 375 | 750 = 750) => `/maps/${slug}/${variant}/map-${size}.webp`,
  mapPng: (slug: string, variant: string) => `/maps/${slug}/${variant}/map.png`,
};
