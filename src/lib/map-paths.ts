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

/** Build a static map URL combining multiple polylines (e.g. all rides in a tour). */
export function buildStaticMapUrlMulti(polylines: string[], apiKey: string, language?: string): string {
  const allPoints: number[][] = [];
  for (const pl of polylines) {
    allPoints.push(...polylineCodec.decode(pl));
  }
  if (allPoints.length === 0) return '';
  return buildStaticMapUrl(polylineCodec.encode(allPoints), apiKey, language);
}

export function buildStaticMapUrl(polyline: string, apiKey: string, language?: string): string {
  const points = polylineCodec.decode(polyline);
  const start = points[0];
  const end = points[points.length - 1];

  const params = new URLSearchParams({
    maptype: 'roadmap',
    size: '800x800',
    scale: '2',
    key: apiKey,
    ...(language && { language }),
  });

  // Base URL + markers use ~250 chars; leave headroom for encoding overhead.
  // Google's limit is 8192 chars — target ~6000 for the polyline portion.
  const baseUrl = `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`
    + `&markers=color:yellow|label:S|${start[0]},${start[1]}`
    + `&markers=color:green|label:F|${end[0]},${end[1]}`;
  const maxPolylineChars = 8192 - baseUrl.length - '&path=enc:'.length - 100;

  // Adaptively sample points — start at every 5th, widen until URL fits
  let interval = 5;
  let simplifiedPolyline: string;
  do {
    const sampled = points.filter((_: number[], i: number) => i % interval === 0);
    if (sampled[sampled.length - 1] !== end) sampled.push(end);
    simplifiedPolyline = polylineCodec.encode(sampled);
    if (simplifiedPolyline.length <= maxPolylineChars) break;
    interval = Math.ceil(interval * 1.5);
  } while (interval < points.length);

  return baseUrl + `&path=enc:${simplifiedPolyline}`;
}
