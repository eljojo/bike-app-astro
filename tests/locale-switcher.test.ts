import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/config/city-config', () => ({
  getCityConfig: vi.fn(() => ({
    locale: 'en-CA',
    locales: ['en-CA', 'fr-CA'],
  })),
}));

import { switchLocalePath } from '../src/lib/locale-switcher';

describe('switchLocalePath()', () => {
  it('English to French: translates segments', () => {
    expect(switchLocalePath('/about', 'en', 'fr')).toBe('/fr/a-propos');
    expect(switchLocalePath('/routes/aylmer/map', 'en', 'fr')).toBe('/fr/parcours/aylmer/carte');
    expect(switchLocalePath('/calendar', 'en', 'fr')).toBe('/fr/calendrier');
    expect(switchLocalePath('/', 'en', 'fr')).toBe('/fr/');
  });

  it('French to English: reverses segments', () => {
    expect(switchLocalePath('/fr/a-propos', 'fr', 'en')).toBe('/about');
    expect(switchLocalePath('/fr/parcours/aylmer/carte', 'fr', 'en')).toBe('/routes/aylmer/map');
    expect(switchLocalePath('/fr/calendrier', 'fr', 'en')).toBe('/calendar');
    expect(switchLocalePath('/fr/', 'fr', 'en')).toBe('/');
  });

  it('uses alternateUrl when provided', () => {
    expect(switchLocalePath('/routes/greenbelt', 'en', 'fr', '/fr/parcours/ceinture-de-verdure'))
      .toBe('/fr/parcours/ceinture-de-verdure');
  });

  it('preserves untranslated segments', () => {
    expect(switchLocalePath('/guides/cycling-101', 'en', 'fr')).toBe('/fr/guides/cycling-101');
    expect(switchLocalePath('/fr/guides/cycling-101', 'fr', 'en')).toBe('/guides/cycling-101');
  });
});
