import { defaultLocale } from './locale-utils';

/**
 * URL path segment translations by locale.
 * Only segments that differ from the default (English) need an entry.
 */
const segmentTranslations: Record<string, Record<string, string>> = {
  about: { fr: 'a-propos', es: 'acerca-de' },
  calendar: { fr: 'calendrier', es: 'calendario' },
  map: { fr: 'carte', es: 'mapa' },
  routes: { fr: 'parcours', es: 'rutas' },
  events: { fr: 'evenements', es: 'eventos' },
  places: { fr: 'lieux', es: 'lugares' },
  rides: { fr: 'sorties', es: 'recorridos' },
  tours: { fr: 'voyages', es: 'viajes' },
  stats: { fr: 'statistiques', es: 'estadisticas' },
  // guides and videos stay the same in French and Spanish
};

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
