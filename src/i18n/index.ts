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
 * Derive a human noun for an event from its tags.
 * Returns a localized noun like "ride", "workshop", "race" —
 * or "event" if no tag maps to a known noun.
 * Pass plural: true for the plural form ("rides", "workshops").
 */
export function eventNoun(tags: string[], locale: string | undefined, plural = false): string {
  const short = shortLocale(locale || defaultLocale());
  const strings = translations[short] || translations[defaultLocale()];
  const fallback = translations[defaultLocale()];
  const idx = plural ? 1 : 0;
  for (const tag of tags) {
    const key = `events.noun.${tag}`;
    const value = strings[key] ?? fallback[key];
    if (value) {
      return Array.isArray(value) ? value[idx] : value;
    }
  }
  const def = strings['events.noun.default'] ?? fallback['events.noun.default'] ?? 'event';
  return Array.isArray(def) ? def[idx] : def;
}

/**
 * Derive the "Next ..." label for an event from its tags.
 * Returns a locale-aware phrase like "Next ride", "Prochain atelier",
 * "Próxima carrera" — with correct grammatical gender per locale.
 */
export function eventNextLabel(tags: string[], locale: string | undefined): string {
  const short = shortLocale(locale || defaultLocale());
  const strings = translations[short] || translations[defaultLocale()];
  const fallback = translations[defaultLocale()];
  for (const tag of tags) {
    const key = `events.next.${tag}`;
    const value = strings[key] ?? fallback[key];
    if (value) return value as string;
  }
  return (strings['events.next.default'] ?? fallback['events.next.default'] ?? 'Next event') as string;
}

/**
 * Derive the sign-up CTA label for an event from its tags.
 * Returns a locale-aware verb like "Sign up", "RSVP", "Register",
 * "S'inscrire", "Participer" — matching the event type.
 */
export function eventSignUpLabel(tags: string[], locale: string | undefined): string {
  const short = shortLocale(locale || defaultLocale());
  const strings = translations[short] || translations[defaultLocale()];
  const fallback = translations[defaultLocale()];
  for (const tag of tags) {
    const key = `events.sign_up.${tag}`;
    const value = strings[key] ?? fallback[key];
    if (value) return value as string;
  }
  return (strings['events.sign_up.default'] ?? fallback['events.sign_up.default'] ?? 'Sign up') as string;
}

/**
 * Derive the "Other ..." editions heading for an event from its tags.
 * Returns a locale-aware phrase like "Other rides", "Autres parcours",
 * "Otras carreras" — with correct grammatical gender per locale.
 */
export function eventEditionsLabel(tags: string[], locale: string | undefined): string {
  const short = shortLocale(locale || defaultLocale());
  const strings = translations[short] || translations[defaultLocale()];
  const fallback = translations[defaultLocale()];
  for (const tag of tags) {
    const key = `events.editions.${tag}`;
    const value = strings[key] ?? fallback[key];
    if (value) return value as string;
  }
  return (strings['events.editions.default'] ?? fallback['events.editions.default'] ?? 'Other events') as string;
}

/**
 * Derive the "go back to all ..." label for an event from its tags.
 * Returns a locale-aware phrase like "go back to all rides",
 * "retour à toutes les courses", "volver a todas las carreras"
 * — with correct grammatical gender per locale.
 */
export function eventGoBackLabel(tags: string[], locale: string | undefined): string {
  const short = shortLocale(locale || defaultLocale());
  const strings = translations[short] || translations[defaultLocale()];
  const fallback = translations[defaultLocale()];
  for (const tag of tags) {
    const key = `events.go_back.${tag}`;
    const value = strings[key] ?? fallback[key];
    if (value) return value as string;
  }
  return (strings['events.go_back.default'] ?? fallback['events.go_back.default'] ?? 'go back to all events') as string;
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
