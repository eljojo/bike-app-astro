/**
 * Node-only helpers for map thumbnail generation (used by scripts/generate-maps.ts).
 * These functions use fs, crypto, and polyline — all Node.js-only and not available in workerd.
 *
 * Functions that are needed by both the script and the Astro app (like mapThumbPaths,
 * variantKeyFromGpx, buildStaticMapUrl) also live here so the script can import them
 * without pulling in virtual modules.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import polylineCodec from '@mapbox/polyline';

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

export function gpxHash(gpxContent: string): string {
  return crypto.createHash('sha256').update(gpxContent).digest('hex').slice(0, 16);
}

export function hashPath(routeSlug: string): string {
  return path.join(CACHE_DIR, routeSlug, '.gpx-hash');
}

export function needsRegeneration(routeSlug: string, currentHash: string): boolean {
  const hp = hashPath(routeSlug);
  if (!fs.existsSync(hp)) return true;
  return fs.readFileSync(hp, 'utf-8').trim() !== currentHash;
}

export function buildStaticMapUrl(polyline: string, apiKey: string): string {
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
  });

  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`
    + `&path=enc:${simplifiedPolyline}`
    + `&markers=color:yellow|label:S|${start[0]},${start[1]}`
    + `&markers=color:green|label:F|${end[0]},${end[1]}`;
}
