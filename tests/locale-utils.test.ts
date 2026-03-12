import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/city-config', () => ({
  getCityConfig: vi.fn(() => ({
    locale: 'en-CA',
    locales: ['en-CA', 'fr-CA'],
  })),
}));

import { shortLocale, fullLocale, defaultLocale, supportedLocales, localeLabel } from '../src/lib/locale-utils';

describe('locale-utils', () => {
  it('shortLocale extracts language code', () => {
    expect(shortLocale('en-CA')).toBe('en');
    expect(shortLocale('fr-CA')).toBe('fr');
    expect(shortLocale('en')).toBe('en');
  });

  it('fullLocale maps short to full', () => {
    expect(fullLocale('en')).toBe('en-CA');
    expect(fullLocale('fr')).toBe('fr-CA');
  });

  it('fullLocale falls back to default for unknown', () => {
    expect(fullLocale('de')).toBe('en-CA');
  });

  it('defaultLocale returns short default', () => {
    expect(defaultLocale()).toBe('en');
  });

  it('supportedLocales returns short codes', () => {
    expect(supportedLocales()).toEqual(['en', 'fr']);
  });
});

describe('localeLabel', () => {
  it('capitalizes English locale name', () => {
    expect(localeLabel('en')).toBe('English');
  });

  it('capitalizes French locale name', () => {
    expect(localeLabel('fr')).toBe('Français');
  });

  it('returns a string for any locale input', () => {
    // Even for unknown locales, Intl.DisplayNames may produce a display name
    // rather than throwing — the function should always return a non-empty string
    const result = localeLabel('xx-INVALID');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
