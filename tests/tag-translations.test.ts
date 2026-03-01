import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the config and locale-utils modules before importing tTag
vi.mock('../src/lib/config', () => ({
  cityDir: '/tmp/test-city',
}));

vi.mock('../src/lib/locale-utils', () => ({
  shortLocale: (l: string) => l.split('-')[0],
  defaultLocale: () => 'en',
}));

// Mock fs to provide tag-translations.yml content
vi.mock('node:fs', () => ({
  default: {
    existsSync: (p: string) => p.endsWith('tag-translations.yml'),
    readFileSync: () => `
bike path:
  fr: piste cyclable
road:
  fr: route
long ride:
  fr: longue sortie
scenic:
  fr: panoramique
family friendly:
  fr: familial
flat:
  fr: plat
elevation:
  fr: dénivelé
ferry:
  fr: traversier
`,
  },
}));

// Must import after mocks are set up
const { tTag } = await import('../src/lib/tag-translations');

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
    // Simulate a route with these tags (as seen on the homepage)
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
