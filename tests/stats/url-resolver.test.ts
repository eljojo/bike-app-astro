import { describe, it, expect } from 'vitest';
import { resolveUrl } from '../../src/lib/stats/url-resolver.server';

describe('resolveUrl', () => {
  const emptyAliases: Record<string, string> = {};
  const emptyRedirects: Record<string, string> = {};

  it('resolves an English route detail page', () => {
    const result = resolveUrl('/routes/britannia', 'en', emptyAliases, emptyRedirects);
    expect(result).toEqual({ contentType: 'route', contentSlug: 'britannia', pageType: 'detail' });
  });

  it('resolves a route map page', () => {
    const result = resolveUrl('/routes/britannia/map', 'en', emptyAliases, emptyRedirects);
    expect(result).toEqual({ contentType: 'route', contentSlug: 'britannia', pageType: 'map' });
  });

  it('resolves a route map variant', () => {
    const result = resolveUrl('/routes/britannia/map/winter', 'en', emptyAliases, emptyRedirects);
    expect(result).toEqual({ contentType: 'route', contentSlug: 'britannia', pageType: 'map:winter' });
  });

  it('resolves an event page', () => {
    const result = resolveUrl('/events/2025/rideau-lakes', 'en', emptyAliases, emptyRedirects);
    expect(result).toEqual({ contentType: 'event', contentSlug: '2025/rideau-lakes', pageType: 'detail' });
  });

  it('resolves a community page', () => {
    const result = resolveUrl('/communities/occ', 'en', emptyAliases, emptyRedirects);
    expect(result).toEqual({ contentType: 'organizer', contentSlug: 'occ', pageType: 'detail' });
  });

  it('returns null for non-content pages', () => {
    expect(resolveUrl('/about', 'en', emptyAliases, emptyRedirects)).toBeNull();
    expect(resolveUrl('/map', 'en', emptyAliases, emptyRedirects)).toBeNull();
    expect(resolveUrl('/admin/routes', 'en', emptyAliases, emptyRedirects)).toBeNull();
    expect(resolveUrl('/api/reactions', 'en', emptyAliases, emptyRedirects)).toBeNull();
    expect(resolveUrl('/calendar', 'en', emptyAliases, emptyRedirects)).toBeNull();
    expect(resolveUrl('/', 'en', emptyAliases, emptyRedirects)).toBeNull();
  });

  it('resolves French route paths', () => {
    const result = resolveUrl('/parcours/britannia', 'fr', emptyAliases, emptyRedirects);
    expect(result).toEqual({ contentType: 'route', contentSlug: 'britannia', pageType: 'detail' });
  });

  it('resolves French translated slugs via alias map', () => {
    const aliases = { 'canal-rideau': 'rideau-canal' };
    const result = resolveUrl('/parcours/canal-rideau', 'fr', aliases, emptyRedirects);
    expect(result).toEqual({ contentType: 'route', contentSlug: 'rideau-canal', pageType: 'detail' });
  });

  it('resolves renamed slugs via redirect map', () => {
    const redirects = { 'old-route': 'new-route' };
    const result = resolveUrl('/routes/old-route', 'en', emptyAliases, redirects);
    expect(result).toEqual({ contentType: 'route', contentSlug: 'new-route', pageType: 'detail' });
  });

  it('handles trailing slashes', () => {
    const result = resolveUrl('/routes/britannia/', 'en', emptyAliases, emptyRedirects);
    expect(result).toEqual({ contentType: 'route', contentSlug: 'britannia', pageType: 'detail' });
  });

  it('resolves flat bike-path URL', () => {
    const result = resolveUrl('/bike-paths/rideau-canal-pathway', 'en', emptyAliases, emptyRedirects);
    expect(result).toEqual({ contentType: 'bike-path', contentSlug: 'rideau-canal-pathway', pageType: 'detail' });
  });

  it('resolves nested bike-path URL (network/member)', () => {
    const result = resolveUrl('/bike-paths/capital-pathway/ottawa-river-pathway', 'en', emptyAliases, emptyRedirects);
    expect(result).toEqual({ contentType: 'bike-path', contentSlug: 'ottawa-river-pathway', pageType: 'detail' });
  });

  it('resolves French nested bike-path URL', () => {
    const result = resolveUrl('/pistes-cyclables/capital-pathway/ottawa-river-pathway', 'fr', emptyAliases, emptyRedirects);
    expect(result).toEqual({ contentType: 'bike-path', contentSlug: 'ottawa-river-pathway', pageType: 'detail' });
  });

  it('applies redirect map to nested bike-path member slug', () => {
    const redirects = { 'old-pathway': 'new-pathway' };
    const result = resolveUrl('/bike-paths/capital-pathway/old-pathway', 'en', emptyAliases, redirects);
    expect(result).toEqual({ contentType: 'bike-path', contentSlug: 'new-pathway', pageType: 'detail' });
  });
});

describe('resolveUrl with real fixture data', () => {
  it('resolves most paths from the page-breakdown fixture', () => {
    const fixture = require('../../e2e/fixtures/plausible/page-breakdown.json');
    const paths = fixture.results.map((r: { dimensions: string[] }) => r.dimensions[0]);
    const emptyAliases: Record<string, string> = {};
    const emptyRedirects: Record<string, string> = {};

    let resolved = 0;
    let skipped = 0;
    for (const p of paths) {
      const locale = p.startsWith('/fr/') ? 'fr' : 'en';
      const pathWithoutLocale = locale === 'fr' ? p.slice(3) : p;
      const result = resolveUrl(pathWithoutLocale, locale, emptyAliases, emptyRedirects);
      if (result) resolved++;
      else skipped++;
    }

    expect(resolved).toBeGreaterThan(0);
    expect(skipped).toBeGreaterThan(0);
  });
});
