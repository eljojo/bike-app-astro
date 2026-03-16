import { describe, it, expect, vi } from 'vitest';

// The buildDataPlugin transforms tag-translations.ts at build time, inlining
// translations from the YAML file. In tests, the plugin loads from the real
// content dir which may not have a tag-translations.yml, resulting in an empty
// translations map. We mock the module here with test data instead.
const translations: Record<string, Record<string, string>> = {
  'bike path': { fr: 'piste cyclable' },
  road: { fr: 'route' },
  'long ride': { fr: 'longue sortie' },
  scenic: { fr: 'panoramique' },
  'family friendly': { fr: 'familial' },
  flat: { fr: 'plat' },
  elevation: { fr: 'dénivelé' },
  ferry: { fr: 'traversier' },
};

vi.mock('../src/lib/i18n/tag-translations.server', () => ({
  tTag: (tag: string, locale: string | undefined) => {
    const short = (locale || 'en').split('-')[0];
    if (short === 'en') return tag;
    const entry = translations[tag];
    return entry?.[short] ?? tag;
  },
}));

const { tTag } = await import('../src/lib/i18n/tag-translations.server');

describe('tTag', () => {
  it('returns French translation when available', () => {
    expect(tTag('bike path', 'fr')).toBe('piste cyclable');
    expect(tTag('scenic', 'fr')).toBe('panoramique');
    expect(tTag('family friendly', 'fr')).toBe('familial');
    expect(tTag('flat', 'fr')).toBe('plat');
  });

  it('returns original tag for English locale', () => {
    expect(tTag('bike path', 'en')).toBe('bike path');
    expect(tTag('scenic', 'en')).toBe('scenic');
  });

  it('returns original tag when no translation exists (e.g. proper nouns)', () => {
    expect(tTag('almonte', 'fr')).toBe('almonte');
    expect(tTag('kinburn', 'fr')).toBe('kinburn');
    expect(tTag('gravel', 'fr')).toBe('gravel');
    expect(tTag('poutine', 'fr')).toBe('poutine');
  });

  it('returns original tag for undefined locale', () => {
    expect(tTag('scenic', undefined)).toBe('scenic');
  });

  it('translates all tags a route card would show on the French homepage', () => {
    const routeTags = ['road', 'gravel', 'ferry', 'long ride', 'poutine', 'elevation'];

    const translated = routeTags.map(tag => tTag(tag, 'fr'));

    expect(translated).toEqual([
      'route',       // road → route
      'gravel',      // stays gravel
      'traversier',  // ferry → traversier
      'longue sortie', // long ride → longue sortie
      'poutine',     // stays poutine
      'dénivelé',    // elevation → dénivelé
    ]);
  });

  it('leaves all tags unchanged on the English homepage', () => {
    const routeTags = ['road', 'gravel', 'ferry', 'long ride', 'poutine', 'elevation'];

    const translated = routeTags.map(tag => tTag(tag, 'en'));

    expect(translated).toEqual(routeTags);
  });
});
