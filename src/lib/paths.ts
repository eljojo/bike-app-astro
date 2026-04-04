/** Centralized URL path construction. One place to change if URL patterns evolve. */
import { defaultLocale } from './i18n/locale-utils';
import { translatePath } from './i18n/path-translations';

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
  // Bike path pages — networkSlug nests the URL: /bike-paths/network/member
  bikePath: (slug: string, networkSlug?: string, locale?: string) =>
    networkSlug
      ? localize(`/bike-paths/${networkSlug}/${slug}`, locale)
      : localize(`/bike-paths/${slug}`, locale),
  bikePaths: (locale?: string) => localize('/bike-paths', locale),
  bikeShops: (locale?: string) => localize('/bike-shops', locale),
  // Community paths
  community: (slug: string, locale?: string) => localize(`/communities/${slug}`, locale),
  communities: (locale?: string) => localize('/communities', locale),
  // Club instance paths
  event: (slug: string, locale?: string) => localize(`/events/${slug}`, locale),
  // Blog instance paths
  ride: (slug: string, tourSlug?: string | null) =>
    tourSlug ? `/tours/${tourSlug}/${slug}` : `/rides/${slug}`,
  rideMap: (slug: string, tourSlug?: string | null) =>
    tourSlug ? `/tours/${tourSlug}/${slug}/map` : `/rides/${slug}/map`,
  rideGpx: (slug: string, variant: string) => `/rides/${slug}/${variant}.gpx`,
  tour: (slug: string) => `/tours/${slug}`,
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
// lang prefix is used for non-default locale maps (e.g. /maps/fr/slug/map-750.webp)
export const assets = {
  mapThumbnail: (slug: string, size: 375 | 750 | 1500 = 750, lang?: string) => {
    const prefix = lang ? `/maps/${lang}` : '/maps';
    return `${prefix}/${slug}/map-${size}.webp`;
  },
  mapThumbnailSrcset: (slug: string, lang?: string) => {
    const prefix = lang ? `/maps/${lang}` : '/maps';
    return `${prefix}/${slug}/map-375.webp 1x, ${prefix}/${slug}/map-750.webp 2x`;
  },
  mapThumbnailSrcsetLarge: (slug: string, lang?: string) => {
    const prefix = lang ? `/maps/${lang}` : '/maps';
    return `${prefix}/${slug}/map-750.webp 1x, ${prefix}/${slug}/map-1500.webp 2x`;
  },
  mapVariantThumbnail: (slug: string, variant: string, size: 375 | 750 = 750, lang?: string) => {
    const prefix = lang ? `/maps/${lang}` : '/maps';
    return `${prefix}/${slug}/${variant}/map-${size}.webp`;
  },
  mapPng: (slug: string, variant: string, lang?: string) => {
    const prefix = lang ? `/maps/${lang}` : '/maps';
    return `${prefix}/${slug}/${variant}/map.png`;
  },
  mapSocial: (slug: string, lang?: string) => {
    const prefix = lang ? `/maps/${lang}` : '/maps';
    return `${prefix}/${slug}/map-social.jpg`;
  },
};
