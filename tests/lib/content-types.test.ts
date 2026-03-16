import { describe, it, expect } from 'vitest';
import { getContentTypes, contentTypes } from '../../src/lib/content/content-types';

describe('content-types', () => {
  it('exports contentTypes without side effects that require import.meta.url', () => {
    // content-types.ts is imported at runtime by AdminHeader.astro and admin-revert.ts.
    // Cloudflare Workers don't have a valid import.meta.url, so the module must not
    // call new URL(..., import.meta.url) at evaluation time. If it does, this import
    // will throw "TypeError: Invalid URL string".
    expect(contentTypes.length).toBeGreaterThan(0);
  });

  it('getContentTypes returns active content types with expected fields', () => {
    const types = getContentTypes();
    expect(types.length).toBeGreaterThan(0);

    for (const ct of types) {
      expect(ct.name).toBeTruthy();
      expect(ct.singular).toBeTruthy();
      expect(ct.label).toBeTruthy();
      // Entrypoints are plain relative view paths, not resolved file paths
      const allRoutes = [
        ...(ct.adminListRoute ? [ct.adminListRoute] : []),
        ...(ct.adminDetailRoutes || []),
        ...(ct.apiRoutes || []),
      ];
      for (const route of allRoutes) {
        expect(route.pattern).toMatch(/^\//);
        expect(route.entrypoint).not.toMatch(/^\//); // relative, not absolute
        expect(route.entrypoint).toMatch(/\.(astro|ts)$/);
      }
    }
  });

  it('every content type has a unique name and singular', () => {
    const names = contentTypes.map(ct => ct.name);
    const singulars = contentTypes.map(ct => ct.singular);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(singulars).size).toBe(singulars.length);
  });
});
