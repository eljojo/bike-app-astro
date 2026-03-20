import { describe, it, expect } from 'vitest';
import { translatePath, reverseTranslatePath, getSegmentTranslations } from '../../src/lib/i18n/path-translations';

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
    expect(translatePath('/routes', 'fr')).toBe('/parcours');
    expect(translatePath('/calendar', 'fr')).toBe('/calendrier');
    expect(translatePath('/map', 'es')).toBe('/mapa');
  });

  it('preserves unknown segments (slugs)', () => {
    expect(translatePath('/routes/britannia/map', 'fr')).toBe('/parcours/britannia/carte');
  });
});

describe('reverseTranslatePath', () => {
  it('reverses translated segments', () => {
    expect(reverseTranslatePath('/parcours/britannia/carte', 'fr')).toBe('/routes/britannia/map');
    expect(reverseTranslatePath('/calendrier', 'fr')).toBe('/calendar');
  });
});
