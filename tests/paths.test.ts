import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/config/city-config', () => ({
  getCityConfig: vi.fn(() => ({
    locale: 'en-CA',
    locales: ['en-CA', 'fr-CA'],
  })),
}));

import { paths, routeSlug } from '../src/lib/paths';

describe('paths', () => {
  it('returns English paths without locale', () => {
    expect(paths.route('aylmer')).toBe('/routes/aylmer');
    expect(paths.routeMap('aylmer')).toBe('/routes/aylmer/map');
  });

  it('returns translated French paths with locale', () => {
    expect(paths.route('aylmer', 'fr')).toBe('/fr/parcours/aylmer');
    expect(paths.routeMap('aylmer', 'fr')).toBe('/fr/parcours/aylmer/carte');
    expect(paths.routeVariantMap('aylmer', 'main', 'fr')).toBe('/fr/parcours/aylmer/carte/main');
    expect(paths.guide('cycling-101', 'fr')).toBe('/fr/guides/cycling-101');
    expect(paths.video('abc123', 'fr')).toBe('/fr/videos/abc123');
  });

  it('returns English paths with default locale', () => {
    expect(paths.route('aylmer', 'en')).toBe('/routes/aylmer');
  });

  it('does not localize GPX paths', () => {
    expect(paths.routeGpx('aylmer', 'main')).toBe('/routes/aylmer/main.gpx');
  });
});

describe('paths.bikePath', () => {
  it('returns flat URL for standalone path (no network)', () => {
    expect(paths.bikePath('rideau-canal-pathway')).toBe('/bike-paths/rideau-canal-pathway');
  });

  it('returns nested URL for network member', () => {
    expect(paths.bikePath('ottawa-river-pathway', 'capital-pathway'))
      .toBe('/bike-paths/capital-pathway/ottawa-river-pathway');
  });

  it('returns flat URL when networkSlug is undefined', () => {
    expect(paths.bikePath('some-path', undefined)).toBe('/bike-paths/some-path');
  });

  it('translates segments for French locale', () => {
    expect(paths.bikePath('rideau-canal-pathway', undefined, 'fr'))
      .toBe('/fr/pistes-cyclables/rideau-canal-pathway');
  });

  it('translates nested network URL for French locale', () => {
    expect(paths.bikePath('ottawa-river-pathway', 'capital-pathway', 'fr'))
      .toBe('/fr/pistes-cyclables/capital-pathway/ottawa-river-pathway');
  });

  it('returns English URL with default locale', () => {
    expect(paths.bikePath('test', undefined, 'en'))
      .toBe('/bike-paths/test');
  });

  it('bikePaths index returns correct path', () => {
    expect(paths.bikePaths()).toBe('/bike-paths');
    expect(paths.bikePaths('fr')).toBe('/fr/pistes-cyclables');
  });
});

describe('routeSlug()', () => {
  const routeWithFrSlug = {
    id: 'greenbelt',
    data: { translations: { fr: { slug: 'ceinture-de-verdure', name: 'Ceinture de verdure' } } },
  };

  const routeWithoutFrSlug = {
    id: 'aylmer',
    data: { translations: { fr: { name: 'Aylmer' } } } as { translations: Record<string, { slug?: string }> },
  };

  const routeNoTranslations = {
    id: 'test-route',
    data: {},
  };

  it('returns French slug when available', () => {
    expect(routeSlug(routeWithFrSlug, 'fr')).toBe('ceinture-de-verdure');
  });

  it('falls back to English slug when no French slug', () => {
    expect(routeSlug(routeWithoutFrSlug, 'fr')).toBe('aylmer');
  });

  it('returns English slug for English locale', () => {
    expect(routeSlug(routeWithFrSlug, 'en')).toBe('greenbelt');
  });

  it('returns English slug for undefined locale', () => {
    expect(routeSlug(routeWithFrSlug, undefined)).toBe('greenbelt');
  });

  it('returns English slug when no translations exist', () => {
    expect(routeSlug(routeNoTranslations, 'fr')).toBe('test-route');
  });
});
