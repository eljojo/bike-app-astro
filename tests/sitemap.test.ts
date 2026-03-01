import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/city-config', () => ({
  getCityConfig: vi.fn(() => ({
    url: 'https://ottawabybike.ca',
    locale: 'en-CA',
    locales: ['en-CA', 'fr-CA'],
  })),
}));

import { buildSitemapEntries } from '../src/lib/sitemap';

describe('buildSitemapEntries', () => {
  it('includes lastmod and priority for routes', () => {
    const entries = buildSitemapEntries({
      routes: [{
        id: 'test-route',
        data: {
          status: 'published',
          updated_at: '2025-01-20',
          variants: [{ name: 'Main', gpx: 'main.gpx' }],
        },
      }],
      guides: [],
    });

    const routeEntry = entries.find(e => e.url.includes('/routes/test-route') && !e.url.includes('/map'));
    expect(routeEntry).toBeDefined();
    expect(routeEntry!.lastmod).toBe('2025-01-20');
    expect(routeEntry!.priority).toBe(0.8);
  });

  it('includes static pages with priority', () => {
    const entries = buildSitemapEntries({ routes: [], guides: [] });
    const home = entries.find(e => e.url === 'https://ottawabybike.ca/');
    expect(home).toBeDefined();
    expect(home!.priority).toBe(1.0);
    const about = entries.find(e => e.url === 'https://ottawabybike.ca/about');
    expect(about).toBeDefined();
    expect(about!.priority).toBe(0.6);
  });

  it('generates locale variants for each page', () => {
    const entries = buildSitemapEntries({ routes: [], guides: [] });
    const enHome = entries.find(e => e.url === 'https://ottawabybike.ca/');
    const frHome = entries.find(e => e.url === 'https://ottawabybike.ca/fr/');
    expect(enHome).toBeDefined();
    expect(frHome).toBeDefined();
    expect(enHome!.alternates).toHaveLength(2);
  });

  it('generates map URLs for each route', () => {
    const entries = buildSitemapEntries({
      routes: [{
        id: 'test-route',
        data: {
          status: 'published',
          updated_at: '2025-01-20',
          variants: [{ name: 'Main', gpx: 'main.gpx' }],
        },
      }],
      guides: [],
    });

    const mapEntry = entries.find(e => e.url.includes('/routes/test-route/map'));
    expect(mapEntry).toBeDefined();
    expect(mapEntry!.priority).toBe(0.2);
  });

  it('filters out non-published routes', () => {
    const entries = buildSitemapEntries({
      routes: [{
        id: 'draft-route',
        data: {
          status: 'draft',
          updated_at: '2025-01-20',
          variants: [],
        },
      }],
      guides: [],
    });
    expect(entries.find(e => e.url.includes('/routes/draft-route'))).toBeUndefined();
  });

  it('uses translated path segments for French locale variants', () => {
    const entries = buildSitemapEntries({ routes: [], guides: [] });

    // French about should use translated segment
    const frAbout = entries.find(e => e.url === 'https://ottawabybike.ca/fr/a-propos');
    expect(frAbout).toBeDefined();

    // Should NOT have untranslated French about
    const frAboutOld = entries.find(e => e.url === 'https://ottawabybike.ca/fr/about');
    expect(frAboutOld).toBeUndefined();

    // French calendar and map
    expect(entries.find(e => e.url === 'https://ottawabybike.ca/fr/calendrier')).toBeDefined();
    expect(entries.find(e => e.url === 'https://ottawabybike.ca/fr/carte')).toBeDefined();
  });

  it('uses translated segments for French route URLs', () => {
    const entries = buildSitemapEntries({
      routes: [{
        id: 'test-route',
        data: {
          status: 'published',
          updated_at: '2025-01-20',
          variants: [{ name: 'Main', gpx: 'main.gpx' }],
        },
      }],
      guides: [],
    });

    // French route should use 'parcours'
    const frRoute = entries.find(e => e.url === 'https://ottawabybike.ca/fr/parcours/test-route');
    expect(frRoute).toBeDefined();

    // French map should use 'parcours' and 'carte'
    const frMap = entries.find(e => e.url === 'https://ottawabybike.ca/fr/parcours/test-route/carte');
    expect(frMap).toBeDefined();

    // Alternates should also use translated URLs
    const enRoute = entries.find(e => e.url === 'https://ottawabybike.ca/routes/test-route');
    const frAlt = enRoute!.alternates!.find(a => a.locale === 'fr');
    expect(frAlt!.url).toBe('https://ottawabybike.ca/fr/parcours/test-route');
  });
});
