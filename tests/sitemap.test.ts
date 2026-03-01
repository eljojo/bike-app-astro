import { describe, it, expect } from 'vitest';
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

    const routeEntry = entries.find(e => e.url.includes('/routes/test-route'));
    expect(routeEntry).toBeDefined();
    expect(routeEntry!.lastmod).toBe('2025-01-20');
    expect(routeEntry!.priority).toBe(0.8);
  });

  it('includes static pages with priority', () => {
    const entries = buildSitemapEntries({ routes: [], guides: [] });
    const home = entries.find(e => e.url === 'https://ottawabybike.ca');
    expect(home!.priority).toBe(1.0);
    const about = entries.find(e => e.url.includes('/about'));
    expect(about!.priority).toBe(0.6);
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
});
