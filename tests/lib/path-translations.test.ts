import { describe, it, expect } from 'vitest';
import { buildSegmentTranslations } from '../../src/lib/path-translations';
import type { LocalePageWithSegments } from '../../src/lib/path-translations';

describe('buildSegmentTranslations', () => {
  it('collects segments from route definitions', () => {
    const pages: LocalePageWithSegments[] = [
      { pattern: '/routes', entrypoint: 'routes.astro', segments: { routes: { fr: 'parcours' } } },
      { pattern: '/about', entrypoint: 'about.astro', segments: { about: { fr: 'a-propos' } } },
    ];
    const result = buildSegmentTranslations(pages);
    expect(result.routes).toEqual({ fr: 'parcours' });
    expect(result.about).toEqual({ fr: 'a-propos' });
  });

  it('deduplicates shared segments across routes', () => {
    const pages: LocalePageWithSegments[] = [
      { pattern: '/routes/[slug]/map', entrypoint: 'map.astro', segments: { map: { fr: 'carte' } } },
      { pattern: '/map', entrypoint: 'map-index.astro', segments: { map: { fr: 'carte' } } },
    ];
    const result = buildSegmentTranslations(pages);
    expect(result.map).toEqual({ fr: 'carte' });
  });

  it('skips routes without segments', () => {
    const pages: LocalePageWithSegments[] = [
      { pattern: '/', entrypoint: 'index.astro' },
      { pattern: '/about', entrypoint: 'about.astro', segments: { about: { es: 'acerca-de' } } },
    ];
    const result = buildSegmentTranslations(pages);
    expect(Object.keys(result)).toEqual(['about']);
  });

  it('merges locale entries for the same segment', () => {
    const pages: LocalePageWithSegments[] = [
      { pattern: '/routes', entrypoint: 'r.astro', segments: { routes: { fr: 'parcours' } } },
      { pattern: '/routes/[slug]', entrypoint: 'rd.astro', segments: { routes: { es: 'rutas' } } },
    ];
    const result = buildSegmentTranslations(pages);
    expect(result.routes).toEqual({ fr: 'parcours', es: 'rutas' });
  });
});
