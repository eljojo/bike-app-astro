import path from 'node:path';
import polylineCodec from '@mapbox/polyline';
import cachedMaps from 'virtual:bike-app/cached-maps';
import { defaultLocale } from './locale-utils';

const CACHE_DIR = path.resolve('public', 'maps');

export interface MapThumbPaths {
  thumb: string;
  thumbSmall: string;
  social: string;
  full: string;
}

export function mapThumbPaths(routeSlug: string, variantKey?: string, lang?: string): MapThumbPaths {
  const base = lang ? path.join(CACHE_DIR, lang) : CACHE_DIR;
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

/** Check if a localized map exists, falling back to the default locale. */
export function hasCachedMap(routeSlug: string, variantKey?: string, locale?: string): boolean {
  const base = variantKey ? `${routeSlug}/${variantKey}` : routeSlug;
  const lang = locale && locale !== defaultLocale() ? locale : undefined;
  if (lang) {
    const localizedKey = `${lang}/${base}`;
    if (cachedMaps.has(localizedKey)) return true;
  }
  return cachedMaps.has(base);
}

/** Resolve the best available locale for a cached map (localized or default). */
export function cachedMapLocale(routeSlug: string, variantKey?: string, locale?: string): string | undefined {
  const base = variantKey ? `${routeSlug}/${variantKey}` : routeSlug;
  const lang = locale && locale !== defaultLocale() ? locale : undefined;
  if (lang && cachedMaps.has(`${lang}/${base}`)) return lang;
  if (cachedMaps.has(base)) return undefined; // default locale, no prefix
  return undefined;
}

export function buildStaticMapUrl(polyline: string, apiKey: string, language?: string): string {
  const points = polylineCodec.decode(polyline);
  const start = points[0];
  const end = points[points.length - 1];

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
