/**
 * URL path segment translations by locale.
 * Only segments that differ from the default (English) need an entry.
 *
 * This is a static constant — NOT a mutable variable set at runtime.
 * Vite's SSR bundle runs in a separate module graph from the Astro
 * integration hooks, so module-level mutable state set during
 * astro:config:setup is not available at render time.
 *
 * When adding a new public route with translated segments, add the
 * segment here AND in the route definition in
 * src/integrations/i18n-routes.ts.
 */
const segmentTranslations: Record<string, Record<string, string>> = {
  // shared
  about: { fr: 'a-propos', es: 'acerca-de' },
  // wiki
  calendar: { fr: 'calendrier', es: 'calendario' },
  communities: { fr: 'communautes', es: 'comunidades' },
  events: { fr: 'evenements', es: 'eventos' },
  map: { fr: 'carte', es: 'mapa' },
  routes: { fr: 'parcours', es: 'rutas' },
  guides: { fr: 'guides', es: 'guias' },
  // club
  paths: { fr: 'sentiers', es: 'senderos' },
  places: { fr: 'lieux', es: 'lugares' },
  // blog
  rides: { fr: 'sorties', es: 'recorridos' },
  tours: { fr: 'voyages', es: 'viajes' },
  stats: { fr: 'statistiques', es: 'estadisticas' },
};

/** Read segment translations. */
export function getSegmentTranslations(): Record<string, Record<string, string>> {
  return segmentTranslations;
}
