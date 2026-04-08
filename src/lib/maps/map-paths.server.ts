import path from 'node:path';
import type { MapThumbPaths } from './map-paths';

export const MAP_CACHE_DIR = path.resolve('public', 'maps');

export function mapThumbPaths(routeSlug: string, variantKey?: string): MapThumbPaths {
  const dir = variantKey ? path.join(MAP_CACHE_DIR, routeSlug, variantKey) : path.join(MAP_CACHE_DIR, routeSlug);
  return {
    thumbLarge: path.join(dir, 'map-1500.webp'),
    thumb: path.join(dir, 'map-750.webp'),
    thumbSmall: path.join(dir, 'map-375.webp'),
    social: path.join(dir, 'map-social.jpg'),
    full: path.join(dir, 'map.png'),
  };
}
