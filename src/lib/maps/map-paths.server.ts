import path from 'node:path';
import type { MapThumbPaths } from './map-paths';

export const MAP_CACHE_DIR = path.resolve('public', 'maps');

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
