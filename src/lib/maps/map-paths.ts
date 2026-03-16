/**
 * Shared map thumbnail helpers — used by both the Astro app (map-thumbnails.ts)
 * and the generation script (map-generation.ts). No virtual module imports here
 * so scripts can use these without Vite.
 */
import path from 'node:path';
import polylineCodec from '@mapbox/polyline';

export const MAP_CACHE_DIR = path.resolve('public', 'maps');

export interface MapThumbPaths {
  thumbLarge: string;
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
    thumbLarge: path.join(dir, 'map-1500.webp'),
    thumb: path.join(dir, 'map-750.webp'),
    thumbSmall: path.join(dir, 'map-375.webp'),
    social: path.join(dir, 'map-social.jpg'),
    full: path.join(dir, 'map.png'),
  };
}

/**
 * Split a list of points into continuous segments, breaking where consecutive
 * points are more than `maxGapKm` apart. Returns segments with 2+ points,
 * sorted longest first.
 */
function splitAtGaps(points: number[][], maxGapKm: number): number[][][] {
  if (points.length === 0) return [];
  const segments: number[][][] = [[points[0]]];
  for (let i = 1; i < points.length; i++) {
    const [lat1, lon1] = points[i - 1];
    const [lat2, lon2] = points[i];
    const dist = haversineKm(lat1, lon1, lat2, lon2);
    if (dist > maxGapKm) {
      segments.push([]);
    }
    segments[segments.length - 1].push(points[i]);
  }
  return segments.filter(s => s.length >= 2).sort((a, b) => b.length - a.length);
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Adaptively sample points until the encoded polyline fits within maxChars. */
function sampleToFit(points: number[][], maxChars: number): string {
  let interval = 5;
  let encoded: string;
  do {
    const sampled = points.filter((_: number[], i: number) => i % interval === 0);
    if (sampled[sampled.length - 1] !== points[points.length - 1]) sampled.push(points[points.length - 1]);
    encoded = polylineCodec.encode(sampled as [number, number][]);
    if (encoded.length <= maxChars) return encoded;
    interval = Math.ceil(interval * 1.5);
  } while (interval < points.length);
  return encoded!;
}

/** Build a static map URL combining multiple polylines (e.g. all rides in a tour).
 *  Each ride is rendered as a separate path to avoid straight lines between them. */
export function buildStaticMapUrlMulti(polylines: string[], apiKey: string, language?: string): string {
  // Decode each ride's polyline into continuous segments (skip GPS gaps >10km)
  const allSegments: number[][][] = [];
  for (const pl of polylines) {
    allSegments.push(...splitAtGaps(polylineCodec.decode(pl), 10));
  }
  if (allSegments.length === 0) return '';

  const allPoints = allSegments.flat();
  const start = allPoints[0];
  const end = allPoints[allPoints.length - 1];

  const params = new URLSearchParams({
    maptype: 'roadmap',
    size: '800x800',
    scale: '2',
    key: apiKey,
    ...(language && { language }),
  });

  let url = `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`
    + `&markers=color:yellow|label:S|${start[0]},${start[1]}`
    + `&markers=color:green|label:F|${end[0]},${end[1]}`;

  // Add each segment as a separate &path= to avoid straight lines between rides/gaps
  for (const segment of allSegments) {
    const remaining = 16384 - url.length - '&path=enc:'.length - 100;
    if (remaining < 50) break;
    url += `&path=enc:${sampleToFit(segment, remaining)}`;
  }

  return url;
}

export function buildStaticMapUrl(polyline: string, apiKey: string, language?: string): string {
  const points = polylineCodec.decode(polyline);
  // Split at GPS gaps (>10km) and render each continuous segment separately
  const segments = splitAtGaps(points, 10);
  if (segments.length === 0) return '';

  const allPoints = segments.flat();
  const start = allPoints[0];
  const end = allPoints[allPoints.length - 1];

  const params = new URLSearchParams({
    maptype: 'roadmap',
    size: '800x800',
    scale: '2',
    key: apiKey,
    ...(language && { language }),
  });

  let url = `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`
    + `&markers=color:yellow|label:S|${start[0]},${start[1]}`
    + `&markers=color:green|label:F|${end[0]},${end[1]}`;

  for (const segment of segments) {
    const remaining = 16384 - url.length - '&path=enc:'.length - 100;
    if (remaining < 50) break;
    url += `&path=enc:${sampleToFit(segment, remaining)}`;
  }

  return url;
}
