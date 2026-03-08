/**
 * Shared map thumbnail helpers — used by both the Astro app (map-thumbnails.ts)
 * and the generation script (map-generation.ts). No virtual module imports here
 * so scripts can use these without Vite.
 */
import path from 'node:path';
import polylineCodec from '@mapbox/polyline';

export const MAP_CACHE_DIR = path.resolve('public', 'maps');

export interface MapThumbPaths {
  thumb: string;
  thumbSmall: string;
  social: string;
  full: string;
}

/** Build cache directory path, optionally scoped by locale (non-default locales get a lang/ prefix). */
export function mapThumbPaths(routeSlug: string, variantKey?: string, lang?: string): MapThumbPaths {
  const base = lang ? path.join(MAP_CACHE_DIR, lang) : MAP_CACHE_DIR;
  const dir = variantKey ? path.join(base, routeSlug, variantKey) : path.join(base, routeSlug);
  return {
    thumb: path.join(dir, 'map-750.webp'),
    thumbSmall: path.join(dir, 'map-375.webp'),
    social: path.join(dir, 'map-social.jpg'),
    full: path.join(dir, 'map.png'),
  };
}

export function variantKeyFromGpx(gpxFilename: string): string {
  return gpxFilename.replace(/\.gpx$/, '').replace(/^variants\//, 'variants-');
}

export function buildStaticMapUrl(polyline: string, apiKey: string, language?: string): string {
  const points = polylineCodec.decode(polyline);
  const start = points[0];
  const end = points[points.length - 1];

  // Sample every 5th point to keep URL under Google's 8192 char limit
  const sampled = points.filter((_: number[], i: number) => i % 5 === 0);
  if (sampled[sampled.length - 1] !== end) sampled.push(end);
  const simplifiedPolyline = polylineCodec.encode(sampled);

  const params = new URLSearchParams({
    maptype: 'roadmap',
    size: '800x800',
    scale: '2',
    key: apiKey,
    ...(language && { language }),
  });

  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`
    + `&path=enc:${simplifiedPolyline}`
    + `&markers=color:yellow|label:S|${start[0]},${start[1]}`
    + `&markers=color:green|label:F|${end[0]},${end[1]}`;
}
