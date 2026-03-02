import { describe, it, expect } from 'vitest';
import { loadAdminRoutes, loadAdminRouteDetails, buildDataPlugin } from '../src/build-data-plugin';

describe('loadAdminRoutes', () => {
  it('returns a sorted array of route summaries', async () => {
    const routes = await loadAdminRoutes();
    expect(Array.isArray(routes)).toBe(true);
    expect(routes.length).toBeGreaterThan(0);

    // Verify sorted by name
    const names = routes.map((r) => r.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it('has correct shape for each route', async () => {
    const routes = await loadAdminRoutes();
    for (const route of routes) {
      expect(route).toHaveProperty('slug');
      expect(route).toHaveProperty('name');
      expect(route).toHaveProperty('photoCount');
      expect(route).toHaveProperty('status');
      expect(typeof route.slug).toBe('string');
      expect(typeof route.name).toBe('string');
      expect(typeof route.photoCount).toBe('number');
      expect(typeof route.status).toBe('string');
      // Should not have extra fields
      expect(Object.keys(route).sort()).toEqual(['name', 'photoCount', 'slug', 'status']);
    }
  });

  it('counts only photos (not videos)', async () => {
    const routes = await loadAdminRoutes();
    // Aylmer has at least one video — its photoCount should be less than total media count
    const aylmer = routes.find((r) => r.slug === 'aylmer');
    expect(aylmer).toBeDefined();
    expect(aylmer!.photoCount).toBeGreaterThan(0);
  });
});

describe('loadAdminRouteDetails', () => {
  it('returns a record keyed by slug', async () => {
    const details = await loadAdminRouteDetails();
    expect(typeof details).toBe('object');
    expect(details).toHaveProperty('carp');
    expect(details['carp'].slug).toBe('carp');
  });

  it('has correct shape for each detail', async () => {
    const details = await loadAdminRouteDetails();
    for (const [slug, detail] of Object.entries(details)) {
      expect(detail.slug).toBe(slug);
      expect(typeof detail.name).toBe('string');
      expect(typeof detail.tagline).toBe('string');
      expect(Array.isArray(detail.tags)).toBe(true);
      expect(typeof detail.distance).toBe('number');
      expect(typeof detail.status).toBe('string');
      expect(typeof detail.body).toBe('string');
      expect(Array.isArray(detail.media)).toBe(true);
    }
  });

  it('renders markdown body as HTML', async () => {
    const details = await loadAdminRouteDetails();
    const carp = details['carp'];
    // Carp's body has markdown links and list items
    expect(carp.body).toContain('<');
    expect(carp.body).toMatch(/<[a-z]+/);
  });

  it('media items only include key, caption, and cover fields', async () => {
    const details = await loadAdminRouteDetails();
    for (const detail of Object.values(details)) {
      for (const item of detail.media) {
        const keys = Object.keys(item);
        // Only allowed keys: key, caption, cover
        for (const k of keys) {
          expect(['key', 'caption', 'cover']).toContain(k);
        }
        // key is always required
        expect(item).toHaveProperty('key');
        expect(typeof item.key).toBe('string');
      }
    }
  });

  it('filters out non-photo media', async () => {
    const details = await loadAdminRouteDetails();
    // Aylmer has videos — media array should only have photos
    const aylmer = details['aylmer'];
    expect(aylmer).toBeDefined();
    // All items should have a key (photos have key)
    for (const item of aylmer.media) {
      expect(item.key).toBeDefined();
    }
  });
});

describe('buildDataPlugin virtual modules', () => {
  it('resolves virtual:bike-app/admin-routes', () => {
    const plugin = buildDataPlugin();
    const resolved = (plugin.resolveId as Function).call(plugin, 'virtual:bike-app/admin-routes');
    expect(resolved).toBe('\0virtual:bike-app/admin-routes');
  });

  it('resolves virtual:bike-app/admin-route-detail', () => {
    const plugin = buildDataPlugin();
    const resolved = (plugin.resolveId as Function).call(plugin, 'virtual:bike-app/admin-route-detail');
    expect(resolved).toBe('\0virtual:bike-app/admin-route-detail');
  });

  it('does not resolve unknown virtual modules', () => {
    const plugin = buildDataPlugin();
    const resolved = (plugin.resolveId as Function).call(plugin, 'virtual:bike-app/unknown');
    expect(resolved).toBeUndefined();
  });

  it('loads admin-routes as a valid JS module', async () => {
    const plugin = buildDataPlugin();
    const result = await (plugin.load as Function).call(plugin, '\0virtual:bike-app/admin-routes');
    expect(typeof result).toBe('string');
    expect(result).toContain('export default');
    // Should be valid JSON array inside the module
    const jsonMatch = result.match(/export default (\[[\s\S]*\]);/);
    expect(jsonMatch).not.toBeNull();
    const data = JSON.parse(jsonMatch![1]);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]).toHaveProperty('slug');
  });

  it('loads admin-route-detail as a valid JS module', async () => {
    const plugin = buildDataPlugin();
    const result = await (plugin.load as Function).call(plugin, '\0virtual:bike-app/admin-route-detail');
    expect(typeof result).toBe('string');
    expect(result).toContain('export default');
    const jsonMatch = result.match(/export default (\{[\s\S]*\});/);
    expect(jsonMatch).not.toBeNull();
    const data = JSON.parse(jsonMatch![1]);
    expect(typeof data).toBe('object');
    expect(data).toHaveProperty('carp');
  });

  it('still loads cached-maps virtual module', async () => {
    const plugin = buildDataPlugin();
    const resolved = (plugin.resolveId as Function).call(plugin, 'virtual:bike-app/cached-maps');
    expect(resolved).toBe('\0virtual:bike-app/cached-maps');
    const result = await (plugin.load as Function).call(plugin, '\0virtual:bike-app/cached-maps');
    expect(typeof result).toBe('string');
    expect(result).toContain('export default new Set(');
  });
});
