import { defaultLocale } from './locale-utils';

export interface LocalePageWithSegments {
  pattern: string;
  entrypoint: string;
  segments?: Record<string, Record<string, string>>;
}

/**
 * Collect segment translations from route definitions into a single map.
 * This is the bridge between colocated route+translation definitions
 * and the translatePath/reverseTranslatePath functions.
 */
export function buildSegmentTranslations(
  pages: LocalePageWithSegments[],
): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  for (const page of pages) {
    if (!page.segments) continue;
    for (const [segment, locales] of Object.entries(page.segments)) {
      if (!result[segment]) result[segment] = {};
      Object.assign(result[segment], locales);
    }
  }
  return result;
}

/**
 * URL path segment translations by locale.
 * Only segments that differ from the default (English) need an entry.
 * Initialized by setSegmentTranslations() during astro:config:setup.
 */
let segmentTranslations: Record<string, Record<string, string>> = {};

/**
 * Initialize segment translations. Called once by the i18n-routes integration
 * during astro:config:setup. After this call, translatePath and
 * reverseTranslatePath use the provided translations.
 */
export function setSegmentTranslations(translations: Record<string, Record<string, string>>): void {
  segmentTranslations = translations;
}

/**
 * Translate a URL path's segments for a given locale.
 * Only translates known top-level segments; slugs and deeper paths pass through.
 * Example: translatePath('/routes/britannia/map', 'fr') → '/parcours/britannia/carte'
 */
export function translatePath(path: string, locale: string): string {
  if (locale === defaultLocale()) return path;
  const parts = path.split('/');
  return parts.map(part => segmentTranslations[part]?.[locale] ?? part).join('/');
}

/**
 * Reverse-translate a URL path's segments from a locale back to default locale.
 * Example: reverseTranslatePath('/parcours/britannia/carte', 'fr') → '/routes/britannia/map'
 */
export function reverseTranslatePath(path: string, locale: string): string {
  if (locale === defaultLocale()) return path;
  const reverse: Record<string, string> = {};
  for (const [english, localeMap] of Object.entries(segmentTranslations)) {
    if (localeMap[locale]) reverse[localeMap[locale]] = english;
  }
  const parts = path.split('/');
  return parts.map(part => reverse[part] ?? part).join('/');
}
