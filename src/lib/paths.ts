/** Centralized URL path construction. One place to change if URL patterns evolve. */

// Page paths
export const paths = {
  route: (slug: string) => `/routes/${slug}`,
  routeMap: (slug: string) => `/routes/${slug}/map`,
  routeVariantMap: (slug: string, variant: string) => `/routes/${slug}/map/${variant}`,
  routeGpx: (slug: string, variant: string) => `/routes/${slug}/${variant}.gpx`,
  guide: (slug: string) => `/guides/${slug}`,
  video: (handle: string) => `/videos/${handle}`,
};

// Static asset paths (map thumbnails)
export const assets = {
  mapThumbnail: (slug: string, size: 375 | 750 = 750) => `/maps/${slug}/map-${size}.webp`,
  mapThumbnailSrcset: (slug: string) => `/maps/${slug}/map-375.webp 1x, /maps/${slug}/map-750.webp 2x`,
  mapVariantThumbnail: (slug: string, variant: string, size: 375 | 750 = 750) => `/maps/${slug}/${variant}/map-${size}.webp`,
  mapPng: (slug: string, variant: string) => `/maps/${slug}/${variant}/map.png`,
};
