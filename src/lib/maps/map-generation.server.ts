/**
 * Node-only helpers for map thumbnail generation (used by scripts/generate-maps.ts).
 * Shared functions (mapThumbPaths, buildStaticMapUrl) live in
 * map-paths.ts and are re-exported here for convenience.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { MAP_CACHE_DIR, mapThumbPaths } from './map-paths.server';
import path from 'node:path';

export { mapThumbPaths };
export { buildStaticMapUrl, buildStaticMapUrlMulti } from './map-paths';
export type { MapThumbPaths } from './map-paths';

export function gpxHash(gpxContent: string): string {
  return crypto.createHash('sha256').update(gpxContent).digest('hex').slice(0, 16);
}

export function hashPath(routeSlug: string, lang?: string): string {
  const base = lang ? path.join(MAP_CACHE_DIR, lang) : MAP_CACHE_DIR;
  return path.join(base, routeSlug, '.gpx-hash');
}

export function needsRegeneration(routeSlug: string, currentHash: string, lang?: string): boolean {
  const hp = hashPath(routeSlug, lang);
  if (!fs.existsSync(hp)) return true;
  if (fs.readFileSync(hp, 'utf-8').trim() !== currentHash) return true;
  // Regenerate if any expected output file is missing (e.g. thumbLarge added later)
  const base = lang ? path.join(MAP_CACHE_DIR, lang) : MAP_CACHE_DIR;
  const dir = path.join(base, routeSlug);
  for (const file of ['map-1500.webp', 'map-750.webp', 'map-375.webp']) {
    if (!fs.existsSync(path.join(dir, file))) return true;
  }
  return false;
}
