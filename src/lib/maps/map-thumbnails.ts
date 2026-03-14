/**
 * Map thumbnail helpers for the Astro app. Re-exports shared functions from
 * map-paths.ts and adds runtime helpers that depend on virtual modules.
 */
import cachedMaps from 'virtual:bike-app/cached-maps';
import { defaultLocale } from '../i18n/locale-utils';

export { mapThumbPaths, variantKeyFromGpx, buildStaticMapUrl } from './map-paths';
export type { MapThumbPaths } from './map-paths';

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
  if (cachedMaps.has(base)) return undefined;
  return undefined;
}
