import { setSegmentTranslations, buildSegmentTranslations } from '../src/lib/path-translations';
import type { LocalePageWithSegments } from '../src/lib/path-translations';

// Initialize segment translations for all tests, mirroring the data
// that i18n-routes.ts colocates on route definitions at build time.
const allPages: LocalePageWithSegments[] = [
  { pattern: '/about', entrypoint: '', segments: { about: { fr: 'a-propos', es: 'acerca-de' } } },
  { pattern: '/calendar', entrypoint: '', segments: { calendar: { fr: 'calendrier', es: 'calendario' } } },
  { pattern: '/events', entrypoint: '', segments: { events: { fr: 'evenements', es: 'eventos' } } },
  { pattern: '/map', entrypoint: '', segments: { map: { fr: 'carte', es: 'mapa' } } },
  { pattern: '/routes', entrypoint: '', segments: { routes: { fr: 'parcours', es: 'rutas' } } },
  { pattern: '/places', entrypoint: '', segments: { places: { fr: 'lieux', es: 'lugares' } } },
  { pattern: '/rides', entrypoint: '', segments: { rides: { fr: 'sorties', es: 'recorridos' } } },
  { pattern: '/tours', entrypoint: '', segments: { tours: { fr: 'voyages', es: 'viajes' } } },
  { pattern: '/stats', entrypoint: '', segments: { stats: { fr: 'statistiques', es: 'estadisticas' } } },
];

setSegmentTranslations(buildSegmentTranslations(allPages));
