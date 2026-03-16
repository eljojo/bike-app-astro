import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDbGet = vi.fn();
const mockDbAll = vi.fn();
vi.mock('../src/lib/get-db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          get: () => mockDbGet(),
          all: () => mockDbAll(),
        }),
      }),
    }),
  }),
}));

vi.mock('../src/db/schema', () => ({
  contentEdits: { contentType: 'contentType', contentSlug: 'contentSlug', city: 'city' },
}));

vi.mock('drizzle-orm', () => ({
  eq: (a: any, b: any) => ({ a, b }),
  and: (...args: any[]) => args,
}));

describe('loadAdminContent', () => {
  let loadAdminContent: typeof import('../src/lib/content/load-admin-content').loadAdminContent;

  const virtualData = {
    'test-slug': { name: 'Virtual Route', slug: 'test-slug' },
  };

  const baseOpts = {
    contentType: 'routes',
    contentSlug: 'test-slug',
    virtualModuleData: virtualData,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbGet.mockResolvedValue(null);
    mockDbAll.mockResolvedValue([]);
    const mod = await import('../src/lib/content/load-admin-content');
    loadAdminContent = mod.loadAdminContent;
  });

  it('returns virtual module data when no cache exists', async () => {
    const result = await loadAdminContent(baseOpts);

    expect(result.data).toEqual({ name: 'Virtual Route', slug: 'test-slug' });
  });

  it('returns null when slug not found anywhere', async () => {
    const result = await loadAdminContent({
      ...baseOpts,
      contentSlug: 'nonexistent',
    });

    expect(result.data).toBeNull();
  });

  it('returns D1 cached data over virtual module', async () => {
    const cached = { name: 'Cached Route', slug: 'test-slug' };
    mockDbGet.mockResolvedValue({ data: JSON.stringify(cached) });

    const result = await loadAdminContent(baseOpts);

    expect(result.data).toEqual(cached);
  });

  it('uses fromCache parser when provided', async () => {
    const { z } = await import('astro/zod');
    const schema = z.object({ slug: z.string(), name: z.string(), distance: z.number() });

    const cached = { slug: 'test-slug', name: 'Parsed Route', distance: 42 };
    mockDbGet.mockResolvedValue({ data: JSON.stringify(cached) });

    const result = await loadAdminContent({
      ...baseOpts,
      fromCache: (blob: string) => schema.parse(JSON.parse(blob)),
    });

    expect(result.data).toEqual(cached);
    expect(result.data).not.toEqual(virtualData['test-slug']);
  });

  it('falls back to virtual module when fromCache throws', async () => {
    const { z } = await import('astro/zod');
    // Schema requires 'distance' which the cached data lacks
    const schema = z.object({ slug: z.string(), name: z.string(), distance: z.number() });

    const cached = { slug: 'test-slug', name: 'Bad Cache' }; // missing required 'distance'
    mockDbGet.mockResolvedValue({ data: JSON.stringify(cached) });

    const result = await loadAdminContent({
      ...baseOpts,
      fromCache: (blob: string) => schema.parse(JSON.parse(blob)),
    });

    // Falls back to virtual module data since fromCache threw
    expect(result.data).toEqual({ name: 'Virtual Route', slug: 'test-slug' });
  });
});

describe('loadAdminContentList', () => {
  let loadAdminContentList: typeof import('../src/lib/content/load-admin-content').loadAdminContentList;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbGet.mockResolvedValue(null);
    mockDbAll.mockResolvedValue([]);
    const mod = await import('../src/lib/content/load-admin-content');
    loadAdminContentList = mod.loadAdminContentList;
  });

  it('returns build-time items when no cache entries exist', async () => {
    const items = [
      { slug: 'route-a', name: 'Route A' },
      { slug: 'route-b', name: 'Route B' },
    ];

    const result = await loadAdminContentList({
      contentType: 'routes',
      buildTimeItems: items,
      getId: (item) => item.slug,
      fromCache: (json: string) => JSON.parse(json),
      overlay: (item, _cached) => item,
      freshItemFromCache: (id, cached) => ({ slug: id, name: cached.name || id }),
    });

    expect(result.items).toHaveLength(2);
    expect(result.items).toEqual(items);
    expect(result.pendingIds.size).toBe(0);
  });

  it('overlays cached data onto matching build-time items', async () => {
    const items = [
      { slug: 'route-a', name: 'Route A' },
      { slug: 'route-b', name: 'Route B' },
    ];

    mockDbAll.mockResolvedValue([
      { contentSlug: 'route-a', data: JSON.stringify({ name: 'Updated A' }) },
    ]);

    const result = await loadAdminContentList({
      contentType: 'routes',
      buildTimeItems: items,
      getId: (item) => item.slug,
      fromCache: (json: string) => JSON.parse(json),
      overlay: (item, cached) => ({ ...item, name: cached.name }),
      freshItemFromCache: (id, cached) => ({ slug: id, name: cached.name || id }),
    });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({ slug: 'route-a', name: 'Updated A' });
    expect(result.items[1]).toEqual({ slug: 'route-b', name: 'Route B' });
    expect(result.pendingIds).toEqual(new Set(['route-a']));
  });

  it('appends cache-only items not in build-time data', async () => {
    const items = [{ slug: 'route-a', name: 'Route A' }];

    mockDbAll.mockResolvedValue([
      { contentSlug: 'route-new', data: JSON.stringify({ name: 'New Route' }) },
    ]);

    const result = await loadAdminContentList({
      contentType: 'routes',
      buildTimeItems: items,
      getId: (item) => item.slug,
      fromCache: (json: string) => JSON.parse(json),
      overlay: (item, _cached) => item,
      freshItemFromCache: (id, cached) => ({ slug: id, name: cached.name || id }),
    });

    expect(result.items).toHaveLength(2);
    expect(result.items[1]).toEqual({ slug: 'route-new', name: 'New Route' });
    expect(result.pendingIds).toEqual(new Set(['route-new']));
  });

  it('skips cache entries that fail fromCache parsing', async () => {
    const items = [{ slug: 'route-a', name: 'Route A' }];

    mockDbAll.mockResolvedValue([
      { contentSlug: 'route-bad', data: 'not valid json!!!' },
    ]);

    const result = await loadAdminContentList({
      contentType: 'routes',
      buildTimeItems: items,
      getId: (item) => item.slug,
      fromCache: (json: string) => JSON.parse(json), // will throw
      overlay: (item, _cached) => item,
      freshItemFromCache: (id, cached) => ({ slug: id, name: cached.name || id }),
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({ slug: 'route-a', name: 'Route A' });
    expect(result.pendingIds.size).toBe(0);
  });
});
