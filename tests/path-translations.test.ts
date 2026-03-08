import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/city-config', () => ({
  getCityConfig: vi.fn(() => ({
    locale: 'en-CA',
    locales: ['en-CA', 'fr-CA'],
  })),
}));

import { translatePath, reverseTranslatePath } from '../src/lib/path-translations';

describe('translatePath()', () => {
  it('returns path unchanged for English', () => {
    expect(translatePath('/routes/aylmer', 'en')).toBe('/routes/aylmer');
    expect(translatePath('/about', 'en')).toBe('/about');
  });

  it('translates known segments for French', () => {
    expect(translatePath('/about', 'fr')).toBe('/a-propos');
    expect(translatePath('/calendar', 'fr')).toBe('/calendrier');
    expect(translatePath('/map', 'fr')).toBe('/carte');
    expect(translatePath('/routes', 'fr')).toBe('/parcours');
  });

  it('translates multiple segments in a path', () => {
    expect(translatePath('/routes/aylmer/map', 'fr')).toBe('/parcours/aylmer/carte');
  });

  it('preserves slugs and unknown segments', () => {
    expect(translatePath('/routes/britannia', 'fr')).toBe('/parcours/britannia');
    expect(translatePath('/guides/cycling-101', 'fr')).toBe('/guides/cycling-101');
  });

  it('preserves segments that are the same in French', () => {
    expect(translatePath('/guides', 'fr')).toBe('/guides');
    expect(translatePath('/videos', 'fr')).toBe('/videos');
  });

  it('handles root path', () => {
    expect(translatePath('/', 'fr')).toBe('/');
  });

  it('handles dynamic route patterns', () => {
    expect(translatePath('/routes/[slug]', 'fr')).toBe('/parcours/[slug]');
    expect(translatePath('/routes/[slug]/map', 'fr')).toBe('/parcours/[slug]/carte');
    expect(translatePath('/routes/[slug]/map/[variant]', 'fr')).toBe('/parcours/[slug]/carte/[variant]');
  });

  it('translates path segments to Spanish', () => {
    expect(translatePath('/routes/some-route/map', 'es')).toBe('/rutas/some-route/mapa');
  });

  it('translates all known segments to Spanish', () => {
    expect(translatePath('/about', 'es')).toBe('/acerca-de');
    expect(translatePath('/calendar', 'es')).toBe('/calendario');
    expect(translatePath('/map', 'es')).toBe('/mapa');
    expect(translatePath('/routes', 'es')).toBe('/rutas');
  });
});

describe('reverseTranslatePath()', () => {
  it('returns path unchanged for default locale', () => {
    expect(reverseTranslatePath('/routes/aylmer', 'en')).toBe('/routes/aylmer');
  });

  it('reverses French segments to English', () => {
    expect(reverseTranslatePath('/a-propos', 'fr')).toBe('/about');
    expect(reverseTranslatePath('/parcours', 'fr')).toBe('/routes');
    expect(reverseTranslatePath('/carte', 'fr')).toBe('/map');
    expect(reverseTranslatePath('/calendrier', 'fr')).toBe('/calendar');
  });

  it('reverses multiple segments in a path', () => {
    expect(reverseTranslatePath('/parcours/aylmer/carte', 'fr')).toBe('/routes/aylmer/map');
  });

  it('preserves unknown segments', () => {
    expect(reverseTranslatePath('/guides/cycling-101', 'fr')).toBe('/guides/cycling-101');
  });

  it('is the inverse of translatePath for all known segments', () => {
    const paths = ['/about', '/routes/aylmer/map', '/calendar', '/map', '/guides'];
    for (const p of paths) {
      expect(reverseTranslatePath(translatePath(p, 'fr'), 'fr')).toBe(p);
    }
  });

  it('reverse-translates Spanish path segments', () => {
    expect(reverseTranslatePath('/rutas/some-route/mapa', 'es')).toBe('/routes/some-route/map');
  });

  it('is the inverse of translatePath for Spanish', () => {
    const paths = ['/about', '/routes/aylmer/map', '/calendar', '/map', '/guides'];
    for (const p of paths) {
      expect(reverseTranslatePath(translatePath(p, 'es'), 'es')).toBe(p);
    }
  });
});
