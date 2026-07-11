import { describe, it, expect, vi } from 'vitest';

// Middleware pulls Astro runtime + virtual modules at import time. Mock them so we
// can import the exported allowlist sets in a plain vitest environment. Mirrors
// tests/middleware.test.ts.
vi.mock('astro:middleware', () => ({
  defineMiddleware: (fn: any) => fn,
}));
vi.mock('../src/lib/auth/auth', () => ({
  validateSession: vi.fn(),
  ANONYMOUS_USER: {
    id: '', username: '', email: null, role: 'guest', bannedAt: null,
    emailInCommits: false, analyticsOptOut: false,
  },
}));
vi.mock('../src/lib/get-db', () => ({ db: () => 'mock-db' }));
vi.mock('virtual:bike-app/ride-redirects', () => ({ default: {} }));
vi.mock('virtual:bike-app/content-redirects', () => ({ default: {} }));

const { BROWSABLE_ADMIN_PATHS, BROWSABLE_ADMIN_PREFIXES } = await import('../src/middleware');
const { contentTypes } = await import('../src/lib/content/content-types.server');

// Browsable admin pages that are NOT content-type list pages. Adding a new one
// is a deliberate act — extend this list and the reader knows why it isn't in the
// registry. This is the documented escape hatch the contract test allows.
const NON_CONTENT_TYPE_BROWSABLE_PATHS = new Set(['/admin', '/admin/history']);

const registryListPatterns = new Set(
  contentTypes
    .filter(ct => ct.adminListRoute)
    .map(ct => ct.adminListRoute!.pattern)
);

describe('browsable admin allowlist ↔ content type registry contract', () => {
  // Forward direction: every content type the registry injects must be reachable
  // by an anonymous reader. This is what broke for /admin/rides (list present,
  // detail prefix missing) and for the /admin/community-new phantom before it.
  for (const ct of contentTypes) {
    if (!ct.adminListRoute) continue;
    const listPattern = ct.adminListRoute.pattern;

    it(`'${ct.name}' list page ${listPattern} is browsable`, () => {
      expect(BROWSABLE_ADMIN_PATHS.has(listPattern)).toBe(true);
    });

    if (ct.adminDetailRoutes && ct.adminDetailRoutes.length > 0) {
      const prefix = `${listPattern}/`;

      it(`'${ct.name}' detail pages under ${prefix} are browsable`, () => {
        expect(BROWSABLE_ADMIN_PREFIXES).toContain(prefix);
        // The derived prefix must actually cover the injected detail patterns.
        for (const r of ct.adminDetailRoutes!) {
          expect(r.pattern.startsWith(prefix)).toBe(true);
        }
      });
    }
  }

  // Reverse direction: nothing in the allowlist is a phantom. Every entry maps to
  // a real registry route (or the documented non-content-type exclusion set).
  it('every browsable admin path maps to a registry list page or a documented exclusion', () => {
    for (const path of BROWSABLE_ADMIN_PATHS) {
      const known = registryListPatterns.has(path) || NON_CONTENT_TYPE_BROWSABLE_PATHS.has(path);
      expect(known, `unexpected browsable admin path: ${path}`).toBe(true);
    }
  });

  it('every browsable admin prefix is a registry list page with a trailing slash', () => {
    for (const prefix of BROWSABLE_ADMIN_PREFIXES) {
      expect(prefix.endsWith('/')).toBe(true);
      const listPattern = prefix.slice(0, -1);
      expect(
        registryListPatterns.has(listPattern),
        `unexpected browsable admin prefix: ${prefix}`
      ).toBe(true);
    }
  });
});
