import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/city-config', () => ({
  getCityConfig: () => ({
    cdn_url: 'https://cdn.ottawabybike.ca',
    videos_cdn_url: 'https://videos.ottawabybike.ca',
    tiles_url: 'https://tiles.ottawabybike.ca/cycle/{z}/{x}/{y}{r}.png',
  }),
}));

const { sharedCspDirectives, buildNonceCspHeader } = await import('../src/lib/csp');

describe('CSP directives', () => {
  it('shared directives do not include script-src (handled per-page)', () => {
    const directives = sharedCspDirectives();
    const scriptSrc = directives.find(d => d.startsWith('script-src'));
    expect(scriptSrc).toBeUndefined();
  });

  it('shared directives include manifest-src self', () => {
    const directives = sharedCspDirectives();
    expect(directives).toContain("manifest-src 'self'");
  });

  it('nonce CSP includes nonce in script-src', () => {
    const header = buildNonceCspHeader('test123');
    expect(header).toContain("script-src 'self' 'nonce-test123'");
    const matches = header.match(/script-src/g);
    expect(matches).toHaveLength(1);
  });
});
