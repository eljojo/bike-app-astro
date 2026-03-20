import { defaultLocale } from './locale-utils';
import { getSegmentTranslations } from './segment-registry';

export { getSegmentTranslations } from './segment-registry';

/**
 * Translate a URL path's segments for a given locale.
 * Only translates known top-level segments; slugs and deeper paths pass through.
 * Example: translatePath('/routes/britannia/map', 'fr') → '/parcours/britannia/carte'
 */
export function translatePath(path: string, locale: string): string {
  if (locale === defaultLocale()) return path;
  const segmentTranslations = getSegmentTranslations();
  const parts = path.split('/');
  return parts.map(part => segmentTranslations[part]?.[locale] ?? part).join('/');
}

/**
 * Reverse-translate a URL path's segments from a locale back to default locale.
 * Example: reverseTranslatePath('/parcours/britannia/carte', 'fr') → '/routes/britannia/map'
 */
export function reverseTranslatePath(path: string, locale: string): string {
  if (locale === defaultLocale()) return path;
  const segmentTranslations = getSegmentTranslations();
  const reverse: Record<string, string> = {};
  for (const [english, localeMap] of Object.entries(segmentTranslations)) {
    if (localeMap[locale]) reverse[localeMap[locale]] = english;
  }
  const parts = path.split('/');
  return parts.map(part => reverse[part] ?? part).join('/');
}
