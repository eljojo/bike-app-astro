/**
 * Map thumbnail helpers for the Astro app. Re-exports shared functions from
 * map-paths.ts and adds runtime helpers that depend on virtual modules.
 */
import cachedMaps from 'virtual:bike-app/cached-maps';

export { mapThumbPaths } from './map-paths.server';
export { buildStaticMapUrl } from './map-paths';
export type { MapThumbPaths } from './map-paths';

export function hasCachedMap(routeSlug: string, variantKey?: string): boolean {
  const key = variantKey ? `${routeSlug}/${variantKey}` : routeSlug;
  return cachedMaps.has(key);
}
