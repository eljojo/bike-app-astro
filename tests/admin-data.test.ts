import { describe, it, expect } from 'vitest';
import { loadAdminRouteData, buildDataPlugin } from '../src/build-data-plugin';

describe('loadAdminRouteData routes', () => {
  it('returns a sorted array of route summaries', { timeout: 15000 }, async () => {
    const { routes } = await loadAdminRouteData();
    expect(Array.isArray(routes)).toBe(true);
    expect(routes.length).toBeGreaterThan(0);

    // Verify sorted by name
    const names = routes.map((r) => r.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it('has correct shape for each route', async () => {
    const { routes } = await loadAdminRouteData();
    for (const route of routes) {
      expect(route).toHaveProperty('slug');
      expect(route).toHaveProperty('name');
      expect(route).toHaveProperty('mediaCount');
      expect(route).toHaveProperty('status');
      expect(route).toHaveProperty('contentHash');
      expect(typeof route.slug).toBe('string');
      expect(typeof route.name).toBe('string');
      expect(typeof route.mediaCount).toBe('number');
      expect(typeof route.status).toBe('string');
      expect(typeof route.contentHash).toBe('string');
      // Should not have extra fields
      expect(Object.keys(route).sort()).toEqual(['contentHash', 'coverKey', 'difficultyScore', 'mediaCount', 'name', 'slug', 'status']);
    }
  });

  it('counts all media items including videos', async () => {
    const { routes } = await loadAdminRouteData();
    const withMedia = routes.find((r) => r.mediaCount > 0);
    expect(withMedia).toBeDefined();
    expect(withMedia!.mediaCount).toBeGreaterThan(0);
  });

  it('includes contentHash in route list items', async () => {
    const { routes } = await loadAdminRouteData();
    expect(routes[0]).toHaveProperty('contentHash');
    expect(typeof routes[0].contentHash).toBe('string');
    expect(routes[0].contentHash.length).toBe(32); // MD5 hex length
  });
});

describe('loadAdminRouteData details', () => {
  it('returns a record keyed by slug', async () => {
    const { details } = await loadAdminRouteData();
    expect(typeof details).toBe('object');
    const firstSlug = Object.keys(details)[0];
    expect(firstSlug).toBeDefined();
    expect(details[firstSlug].slug).toBe(firstSlug);
  });

  it('has correct shape for each detail', async () => {
    const { details } = await loadAdminRouteData();
    for (const [slug, detail] of Object.entries(details)) {
      expect(detail.slug).toBe(slug);
      expect(typeof detail.name).toBe('string');
      expect(typeof detail.tagline).toBe('string');
      expect(Array.isArray(detail.tags)).toBe(true);
      expect(typeof detail.status).toBe('string');
      expect(typeof detail.body).toBe('string');
      expect(Array.isArray(detail.media)).toBe(true);
    }
  });

  it('stores body as raw markdown (not rendered HTML)', async () => {
    const { details } = await loadAdminRouteData();
    const firstSlug = Object.keys(details)[0];
    const detail = details[firstSlug];
    // Body should be raw markdown, not rendered HTML
    expect(detail.body.length).toBeGreaterThan(0);
    expect(detail.body).not.toMatch(/^<p>/); // should NOT be rendered HTML
  });

  it('media items only include known fields', async () => {
    const { details } = await loadAdminRouteData();
    const allowedKeys = ['key', 'type', 'caption', 'cover', 'lat', 'lng', 'uploaded_by', 'captured_at', 'width', 'height', 'title', 'handle', 'duration', 'orientation'];
    for (const detail of Object.values(details)) {
      for (const item of detail.media) {
        const keys = Object.keys(item);
        for (const k of keys) {
          expect(allowedKeys).toContain(k);
        }
        // key is always required
        expect(item).toHaveProperty('key');
        expect(typeof item.key).toBe('string');
      }
    }
  });

  it('all media items have a key', async () => {
    const { details } = await loadAdminRouteData();
    const withMedia = Object.values(details).find((d) => d.media.length > 0);
    expect(withMedia).toBeDefined();
    for (const item of withMedia!.media) {
      expect(item.key).toBeDefined();
    }
  });

  it('includes contentHash for each route detail', async () => {
    const { details } = await loadAdminRouteData();
    const slug = Object.keys(details)[0];
    expect(details[slug]).toHaveProperty('contentHash');
    expect(typeof details[slug].contentHash).toBe('string');
    expect(details[slug].contentHash.length).toBe(32); // MD5 hex length
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
    expect(Object.keys(data).length).toBeGreaterThan(0);
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
