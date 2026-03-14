import en from './en.json';
import fr from './fr.json';
import es from './es.json';
import { shortLocale, fullLocale, defaultLocale } from '../lib/i18n/locale-utils';
import { translatePath } from '../lib/i18n/path-translations';

type Translations = Record<string, string | string[]>;

const translations: Record<string, Translations> = { en, fr, es };

/**
 * Translate a UI string key for the given locale.
 * Supports interpolation: t('hello.{name}', 'en', { name: 'World' })
 */
export function t(key: string, locale: string | undefined, vars?: Record<string, string | number>): string {
  const short = shortLocale(locale || defaultLocale());
  const strings = translations[short] || translations[defaultLocale()];
  let value = strings[key] ?? (translations[defaultLocale()][key] as string) ?? key;
  if (Array.isArray(value)) value = value[0]; // default to singular
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      value = value.replace(`{${k}}`, String(v));
    }
  }
  return value;
}

/**
 * Get a category name with correct singular/plural form.
 */
export function tCategory(category: string, count: number, locale: string | undefined): string {
  const short = shortLocale(locale || defaultLocale());
  const strings = translations[short] || translations[defaultLocale()];
  const key = `category.${category}`;
  const names = (strings[key] as string[] | undefined) || (translations[defaultLocale()][key] as string[] | undefined) || [category, category];
  const rule = new Intl.PluralRules(fullLocale(short)).select(count);
  const idx = rule === 'one' ? 0 : Math.min(1, names.length - 1);
  return names[idx];
}

/**
 * Get the full Intl locale for formatting (e.g. 'en-CA', 'fr-CA').
 */
export function formatLocale(locale: string | undefined): string {
  return fullLocale(shortLocale(locale || defaultLocale()));
}

/**
 * Get ordinal suffix for a number in the given locale.
 */
export function tOrdinal(n: number, locale: string | undefined): string {
  const short = shortLocale(locale || defaultLocale());
  const strings = translations[short] || translations[defaultLocale()];
  const key = `ordinal.${n}`;
  return (strings[key] as string) ?? (strings['ordinal.other'] as string) ?? '';
}

/**
 * Build a locale-prefixed path. Default locale gets no prefix.
 */
export function localePath(path: string, locale: string | undefined): string {
  const short = shortLocale(locale || defaultLocale());
  if (short === defaultLocale()) return path;
  const translated = translatePath(path, short);
  return `/${short}${translated}`;
}
