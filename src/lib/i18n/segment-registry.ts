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

/** Read current segment translations. */
export function getSegmentTranslations(): Record<string, Record<string, string>> {
  return segmentTranslations;
}
