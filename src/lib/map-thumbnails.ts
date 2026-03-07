import path from 'node:path';
import polylineCodec from '@mapbox/polyline';
import cachedMaps from 'virtual:bike-app/cached-maps';

const CACHE_DIR = path.resolve('public', 'maps');

export interface MapThumbPaths {
  thumb: string;
  thumbSmall: string;
  social: string;
  full: string;
}

export function mapThumbPaths(routeSlug: string, variantKey?: string): MapThumbPaths {
  const dir = variantKey ? path.join(CACHE_DIR, routeSlug, variantKey) : path.join(CACHE_DIR, routeSlug);
  return {
    thumb: path.join(dir, 'map-750.webp'),
    thumbSmall: path.join(dir, 'map-375.webp'),
    social: path.join(dir, 'map-social.jpg'),
    full: path.join(dir, 'map.png'),
  };
}

export function variantKeyFromGpx(gpxFilename: string): string {
  return gpxFilename.replace(/\.gpx$/, '').replace(/^variants\//, '');
}

export function hasCachedMap(routeSlug: string, variantKey?: string): boolean {
  const key = variantKey ? `${routeSlug}/${variantKey}` : routeSlug;
  return cachedMaps.has(key);
}

export function buildStaticMapUrl(polyline: string, apiKey: string): string {
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
  });

  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`
    + `&path=enc:${simplifiedPolyline}`
    + `&markers=color:yellow|label:S|${start[0]},${start[1]}`
    + `&markers=color:green|label:F|${end[0]},${end[1]}`;
}
