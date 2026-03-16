import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/config/city-config', () => ({
  getCityConfig: vi.fn(() => ({
    locale: 'en-CA',
    locales: ['en-CA', 'fr-CA'],
  })),
}));

import { t, tCategory, tOrdinal, formatLocale, localePath } from '../src/i18n/index';

describe('t()', () => {
  it('returns English string by default', () => {
    expect(t('nav.about', 'en')).toBe('About');
  });

  it('returns French string', () => {
    expect(t('nav.about', 'fr')).toBe('À propos');
  });

  it('falls back to English for unknown locale', () => {
    expect(t('nav.about', 'de')).toBe('About');
  });

  it('returns key itself if not found anywhere', () => {
    expect(t('nonexistent.key', 'en')).toBe('nonexistent.key');
  });

  it('interpolates variables', () => {
    expect(t('route.view_map', 'en', { name: 'Aylmer' })).toBe('View Map of Aylmer');
    expect(t('route.view_map', 'fr', { name: 'Aylmer' })).toBe('Voir la carte de Aylmer');
  });

  it('handles undefined locale as English', () => {
    expect(t('nav.about', undefined)).toBe('About');
  });

  it('handles full locale codes', () => {
    expect(t('nav.about', 'fr-CA')).toBe('À propos');
  });

  it('difficulty range reads as a natural sentence', () => {
    const low = t('difficulty.easiest', 'en');
    const result = t('difficulty.range', 'en', { low });
    expect(result).toBe('Depends on the version, but generally one of the easiest routes on this site');
  });

  it('difficulty labels use relative language, not absolutes', () => {
    // Labels should say "easier/harder than most" not "easy/hard" —
    // everyone's fitness level is different
    const labels = ['easiest', 'easy', 'average', 'hard', 'hardest']
      .map(key => t(`difficulty.${key}`, 'en'));
    for (const label of labels) {
      expect(label).not.toMatch(/^(Very )?(Easy|Hard|Moderate|Challenging)$/i);
    }
  });
});

describe('tCategory()', () => {
  it('returns singular form for count 1', () => {
    expect(tCategory('cafe', 1, 'en')).toBe('cafe');
    expect(tCategory('cafe', 1, 'fr')).toBe('café');
  });

  it('returns plural form for count > 1', () => {
    expect(tCategory('cafe', 3, 'en')).toBe('cafes');
    expect(tCategory('cafe', 3, 'fr')).toBe('cafés');
  });

  it('uses locale-aware plural rules', () => {
    // French treats 0 as singular ("one"), English treats 0 as plural ("other")
    expect(tCategory('cafe', 0, 'fr')).toBe('café');
    expect(tCategory('cafe', 0, 'en')).toBe('cafes');
  });

  it('falls back for unknown category', () => {
    expect(tCategory('unknown', 1, 'en')).toBe('unknown');
    expect(tCategory('unknown', 2, 'en')).toBe('unknown');
  });
});

describe('tOrdinal()', () => {
  it('returns English ordinals', () => {
    expect(tOrdinal(1, 'en')).toBe('st');
    expect(tOrdinal(2, 'en')).toBe('nd');
    expect(tOrdinal(3, 'en')).toBe('rd');
    expect(tOrdinal(4, 'en')).toBe('th');
  });

  it('returns French ordinals', () => {
    expect(tOrdinal(1, 'fr')).toBe('er');
    expect(tOrdinal(2, 'fr')).toBe('e');
  });
});

describe('formatLocale()', () => {
  it('maps short to full locale', () => {
    expect(formatLocale('en')).toBe('en-CA');
    expect(formatLocale('fr')).toBe('fr-CA');
  });
});

describe('localePath()', () => {
  it('returns path unchanged for default locale', () => {
    expect(localePath('/about', 'en')).toBe('/about');
    expect(localePath('/', 'en')).toBe('/');
  });

  it('translates path segments for French', () => {
    expect(localePath('/routes/aylmer', 'fr')).toBe('/fr/parcours/aylmer');
    expect(localePath('/routes/aylmer/map', 'fr')).toBe('/fr/parcours/aylmer/carte');
    expect(localePath('/calendar', 'fr')).toBe('/fr/calendrier');
    expect(localePath('/map', 'fr')).toBe('/fr/carte');
  });

  it('preserves segments that are the same in French', () => {
    expect(localePath('/guides', 'fr')).toBe('/fr/guides');
    expect(localePath('/guides/cycling-101', 'fr')).toBe('/fr/guides/cycling-101');
    expect(localePath('/videos', 'fr')).toBe('/fr/videos');
  });

  it('translates root path for French', () => {
    expect(localePath('/', 'fr')).toBe('/fr/');
  });
});
