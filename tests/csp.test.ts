import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/config/city-config', () => ({
  getCityConfig: () => ({
    cdn_url: 'https://cdn.example.com',
    videos_cdn_url: 'https://videos.example.com',
    display_name: 'Test City',
    domain: 'test.whereto.bike',
    instance_type: 'wiki',
  }),
}));

const { sharedCspDirectives, buildNonceCspHeader, cspOrigins } = await import('../src/lib/csp');

describe('cspOrigins', () => {
  it('returns CDN and video origins from city config', () => {
    const origins = cspOrigins();
    expect(origins.cdn).toBe('https://cdn.example.com');
    expect(origins.videos).toBe('https://videos.example.com');
  });
});

describe('sharedCspDirectives', () => {
  it('includes all expected directive types', () => {
    const directives = sharedCspDirectives();
    const directiveNames = directives.map((d) => d.split(' ')[0]);

    expect(directiveNames).toContain("default-src");
    expect(directiveNames).toContain("base-uri");
    expect(directiveNames).toContain("object-src");
    expect(directiveNames).toContain("frame-ancestors");
    expect(directiveNames).toContain("form-action");
    expect(directiveNames).toContain("img-src");
    expect(directiveNames).toContain("media-src");
    expect(directiveNames).toContain("font-src");
    expect(directiveNames).toContain("connect-src");
    expect(directiveNames).toContain("worker-src");
    expect(directiveNames).toContain("frame-src");
    expect(directiveNames).toContain("manifest-src");
  });

  it('sets frame-ancestors to none', () => {
    const directives = sharedCspDirectives();
    const frameAncestors = directives.find((d) => d.startsWith('frame-ancestors'));
    expect(frameAncestors).toBe("frame-ancestors 'none'");
  });

  it('includes CDN origin in img-src', () => {
    const directives = sharedCspDirectives();
    const imgSrc = directives.find((d) => d.startsWith('img-src'));
    expect(imgSrc).toContain('https://cdn.example.com');
  });

  it('includes video CDN in connect-src', () => {
    const directives = sharedCspDirectives();
    const connectSrc = directives.find((d) => d.startsWith('connect-src'));
    expect(connectSrc).toContain('https://videos.example.com');
  });

  it('includes optional R2 origin in connect-src when provided', () => {
    const directives = sharedCspDirectives({ r2Origin: 'https://r2.example.com' });
    const connectSrc = directives.find((d) => d.startsWith('connect-src'));
    expect(connectSrc).toContain('https://r2.example.com');
  });

  it('includes optional S3 origin in connect-src when provided', () => {
    const directives = sharedCspDirectives({ s3Origin: 'https://s3.example.com' });
    const connectSrc = directives.find((d) => d.startsWith('connect-src'));
    expect(connectSrc).toContain('https://s3.example.com');
  });

  it('sets object-src to none', () => {
    const directives = sharedCspDirectives();
    const objectSrc = directives.find((d) => d.startsWith('object-src'));
    expect(objectSrc).toBe("object-src 'none'");
  });
});

describe('buildNonceCspHeader', () => {
  it('includes nonce in script-src', () => {
    const header = buildNonceCspHeader('test-nonce-123');
    expect(header).toContain("script-src 'self' 'nonce-test-nonce-123'");
  });

  it('does not include unsafe-inline in script-src', () => {
    const header = buildNonceCspHeader('test-nonce-456');
    // Extract just the script-src directive
    const scriptSrc = header.split('; ').find((d) => d.startsWith('script-src'));
    expect(scriptSrc).not.toContain('unsafe-inline');
  });

  it('includes unsafe-inline in style-src (required for inline styles)', () => {
    const header = buildNonceCspHeader('test-nonce');
    const styleSrc = header.split('; ').find((d) => d.startsWith('style-src '));
    expect(styleSrc).toContain("'unsafe-inline'");
  });

  it('builds a semicolon-separated header string', () => {
    const header = buildNonceCspHeader('nonce-test');
    expect(header).toContain('; ');
    const parts = header.split('; ');
    // Should have shared directives + script-src + style-src + style-src-attr
    expect(parts.length).toBeGreaterThan(12);
  });

  it('includes frame-ancestors none in the full header', () => {
    const header = buildNonceCspHeader('nonce');
    expect(header).toContain("frame-ancestors 'none'");
  });
});
