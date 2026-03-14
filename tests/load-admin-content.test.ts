import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDbSelect = vi.fn();
vi.mock('../src/lib/get-db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          get: () => mockDbSelect(),
        }),
      }),
    }),
  }),
}));

vi.mock('../src/db/schema', () => ({
  contentEdits: { contentType: 'contentType', contentSlug: 'contentSlug' },
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
    mockDbSelect.mockResolvedValue(null);
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
    mockDbSelect.mockResolvedValue({ data: JSON.stringify(cached) });

    const result = await loadAdminContent(baseOpts);

    expect(result.data).toEqual(cached);
  });
});
