import { defaultLocale } from './locale-utils';
import { translatePath, reverseTranslatePath } from './path-translations';

/**
 * Compute the URL for switching locales.
 * Uses alternateUrl when provided (for pages with translated slugs like routes).
 * Otherwise reverse-translates segments to default locale, then translates to target.
 */
export function switchLocalePath(
  currentPath: string,
  currentLocale: string,
  targetLocale: string,
  alternateUrl?: string,
): string {
  if (alternateUrl) return alternateUrl;

  const defLocale = defaultLocale();

  // Strip locale prefix and reverse-translate to get the default-locale base path
  let basePath: string;
  if (currentLocale !== defLocale) {
    const stripped = currentPath.replace(new RegExp(`^/${currentLocale}(/|$)`), '$1') || '/';
    basePath = reverseTranslatePath(stripped, currentLocale);
  } else {
    basePath = currentPath;
  }

  // Translate to target locale
  if (targetLocale === defLocale) {
    return basePath;
  }
  const translated = translatePath(basePath, targetLocale);
  return translated === '/' ? `/${targetLocale}/` : `/${targetLocale}${translated}`;
}
