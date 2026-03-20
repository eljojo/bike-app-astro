import { describe, it, expect } from 'vitest';
import { translatePath, reverseTranslatePath, getSegmentTranslations } from '../../src/lib/i18n/path-translations';
import { defaultLocale } from '../../src/lib/i18n/locale-utils';

describe('getSegmentTranslations', () => {
  it('contains expected segments', () => {
    const translations = getSegmentTranslations();
    expect(translations.routes).toEqual({ fr: 'parcours', es: 'rutas' });
    expect(translations.calendar).toEqual({ fr: 'calendrier', es: 'calendario' });
    expect(translations.about).toEqual({ fr: 'a-propos', es: 'acerca-de' });
    expect(translations.map).toEqual({ fr: 'carte', es: 'mapa' });
  });
});

describe('translatePath', () => {
  it('translates known segments', () => {
    // Use a non-default locale — demo city defaults to 'es', ottawa to 'en'
    const nonDefault = defaultLocale() === 'fr' ? 'es' : 'fr';
    const expected = nonDefault === 'fr'
      ? { routes: '/parcours', calendar: '/calendrier', map: '/carte' }
      : { routes: '/rutas', calendar: '/calendario', map: '/mapa' };
    expect(translatePath('/routes', nonDefault)).toBe(expected.routes);
    expect(translatePath('/calendar', nonDefault)).toBe(expected.calendar);
    expect(translatePath('/map', nonDefault)).toBe(expected.map);
  });

  it('preserves unknown segments (slugs)', () => {
    const nonDefault = defaultLocale() === 'fr' ? 'es' : 'fr';
    const expected = nonDefault === 'fr'
      ? '/parcours/britannia/carte'
      : '/rutas/britannia/mapa';
    expect(translatePath('/routes/britannia/map', nonDefault)).toBe(expected);
  });
});

describe('reverseTranslatePath', () => {
  it('reverses translated segments', () => {
    const nonDefault = defaultLocale() === 'fr' ? 'es' : 'fr';
    if (nonDefault === 'fr') {
      expect(reverseTranslatePath('/parcours/britannia/carte', 'fr')).toBe('/routes/britannia/map');
      expect(reverseTranslatePath('/calendrier', 'fr')).toBe('/calendar');
    } else {
      expect(reverseTranslatePath('/rutas/britannia/mapa', 'es')).toBe('/routes/britannia/map');
      expect(reverseTranslatePath('/calendario', 'es')).toBe('/calendar');
    }
  });
});
