import { describe, it, expect } from 'vitest';
import { mergeLocaleContent } from '../src/loaders/locale-content';
import { makePreview } from '../src/lib/markdown-preview';

describe('mergeLocaleContent', () => {
  it('returns base content when no translation exists', () => {
    const base = { name: 'Aylmer', tagline: 'Ride of the Year', renderedBody: '<p>English</p>' };
    const result = mergeLocaleContent(base, undefined);
    expect(result.name).toBe('Aylmer');
    expect(result.renderedBody).toBe('<p>English</p>');
  });

  it('overrides text fields from translation', () => {
    const base = { name: 'Aylmer', tagline: 'Ride of the Year', renderedBody: '<p>English</p>' };
    const translation = { name: 'Aylmer', tagline: "Parcours de l'ann\u00e9e", renderedBody: '<p>Fran\u00e7ais</p>' };
    const result = mergeLocaleContent(base, translation);
    expect(result.name).toBe('Aylmer');
    expect(result.tagline).toBe("Parcours de l'ann\u00e9e");
    expect(result.renderedBody).toBe('<p>Fran\u00e7ais</p>');
  });

  it('keeps base fields when translation omits them', () => {
    const base = { name: 'Aylmer', tagline: 'Ride of the Year', renderedBody: '<p>English</p>' };
    const translation = { renderedBody: '<p>Fran\u00e7ais</p>' };
    const result = mergeLocaleContent(base, translation);
    expect(result.name).toBe('Aylmer');
    expect(result.tagline).toBe('Ride of the Year');
    expect(result.renderedBody).toBe('<p>Fran\u00e7ais</p>');
  });

  it('does not override with null values', () => {
    const base = { name: 'Aylmer', tagline: 'Ride of the Year' };
    const translation = { name: null, tagline: 'Nouveau tagline' } as any;
    const result = mergeLocaleContent(base, translation);
    expect(result.name).toBe('Aylmer');
    expect(result.tagline).toBe('Nouveau tagline');
  });
});

describe('localizedRouteFields', () => {
  it('returns translated name and tagline for non-default locale', () => {
    const routeData = {
      name: 'Aylmer',
      tagline: 'Ride of the Year: 2022',
      translations: {
        fr: { name: 'Aylmer', tagline: "Parcours de l'année : 2022" },
      },
    };

    // This is the pattern that should be used on BOTH the route detail page
    // AND the route listing (homepage). Currently the homepage passes
    // route.data.name directly without checking translations.
    const locale = 'fr';
    const trans = routeData.translations?.[locale];
    const localeName = trans?.name || routeData.name;
    const localeTagline = trans?.tagline || routeData.tagline;

    expect(localeName).toBe('Aylmer');
    expect(localeTagline).toBe("Parcours de l'année : 2022");
  });

  it('falls back to default when translation is missing', () => {
    const routeData = {
      name: 'Greenbelt',
      tagline: 'Escape the city',
      translations: {},
    };

    const locale = 'fr';
    const trans = routeData.translations?.[locale];
    const localeName = trans?.name || routeData.name;
    const localeTagline = trans?.tagline || routeData.tagline;

    expect(localeName).toBe('Greenbelt');
    expect(localeTagline).toBe('Escape the city');
  });

  it('returns translated body for non-default locale', () => {
    const routeData = {
      name: 'Britannia',
      tagline: 'Ride of the Year: 2021',
      body: 'Ready to pedal your way into an easy breezy escapade?',
      translations: {
        fr: {
          name: "Britannia par le sentier de la rivière des Outaouais",
          tagline: "Parcours de l'année : 2021",
          body: "Prêt à pédaler pour une escapade facile et agréable?",
        },
      },
    };

    const locale = 'fr';
    const trans = routeData.translations?.[locale];
    const localeBody = trans?.body || routeData.body;

    expect(localeBody).toBe("Prêt à pédaler pour une escapade facile et agréable?");
  });

  it('homepage route card preview uses translated body', () => {
    const enBody = 'Ready to pedal your way into an easy breezy escapade? Buckle up for a delightful ride along the Ottawa River Pathway.';
    const frBody = "Prêt à pédaler pour une **escapade facile et agréable**? Attachez votre casque pour une balade le long du sentier de la rivière des Outaouais.";

    const routeData = {
      name: 'Britannia',
      body: enBody,
      translations: {
        fr: {
          name: "Britannia par le sentier de la rivière des Outaouais",
          body: frBody,
        },
      },
    };

    // Simulate what index.astro does: pick translated body, then preview it
    const locale = 'fr';
    const trans = routeData.translations?.[locale];
    const bodyForPreview = trans?.body || routeData.body;
    const preview = makePreview(bodyForPreview);

    // Preview should be French, not English
    expect(preview[0]).toContain('pédaler');
    expect(preview[0]).not.toContain('pedal');
  });

  it('homepage route card preview falls back to English when no translation', () => {
    const enBody = 'Ready to pedal your way into an easy breezy escapade?';
    const routeData = {
      name: 'Greenbelt',
      body: enBody,
      translations: {},
    };

    const locale = 'fr';
    const trans = (routeData.translations as Record<string, any>)?.[locale];
    const bodyForPreview = trans?.body || routeData.body;
    const preview = makePreview(bodyForPreview);

    expect(preview[0]).toContain('pedal');
  });
});
