import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AdminContentResult } from '../src/lib/load-admin-content';

// Mock dependencies before importing the module
vi.mock('../src/lib/env', () => ({
  env: { GITHUB_TOKEN: 'test-token' },
}));

vi.mock('../src/lib/config', () => ({
  GIT_OWNER: 'test-owner',
  GIT_DATA_REPO: 'test-repo',
}));

const mockFindDraft = vi.fn();
const mockDeleteDraft = vi.fn();
vi.mock('../src/lib/draft-service', () => ({
  findDraft: (...args: any[]) => mockFindDraft(...args),
  deleteDraft: (...args: any[]) => mockDeleteDraft(...args),
}));

const mockGetRef = vi.fn();
const mockReadFile = vi.fn();
vi.mock('../src/lib/git-factory', () => ({
  createGitService: () => ({
    getRef: (...args: any[]) => mockGetRef(...args),
    readFile: (...args: any[]) => mockReadFile(...args),
  }),
}));

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
  let loadAdminContent: typeof import('../src/lib/load-admin-content').loadAdminContent;

  const virtualData = {
    'test-slug': { name: 'Virtual Route', slug: 'test-slug' },
  };

  const baseOpts = {
    contentType: 'routes',
    contentSlug: 'test-slug',
    gitFilePath: 'ottawa/routes/test-slug/index.md',
    parseGitFile: vi.fn(),
    virtualModuleData: virtualData,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFindDraft.mockResolvedValue(null);
    mockDbSelect.mockResolvedValue(null);
    const mod = await import('../src/lib/load-admin-content');
    loadAdminContent = mod.loadAdminContent;
  });

  it('returns virtual module data when no draft or cache exists', async () => {
    const result = await loadAdminContent({
      ...baseOpts,
      user: { id: 'u1', email: null, displayName: 'Test', role: 'admin' },
    });

    expect(result.data).toEqual({ name: 'Virtual Route', slug: 'test-slug' });
    expect(result.isDraft).toBe(false);
    expect(result.draftPrNumber).toBeNull();
  });

  it('returns null when slug not found anywhere', async () => {
    const result = await loadAdminContent({
      ...baseOpts,
      user: { id: 'u1', email: null, displayName: 'Test', role: 'admin' },
      contentSlug: 'nonexistent',
    });

    expect(result.data).toBeNull();
  });

  it('returns D1 cached data over virtual module', async () => {
    const cached = { name: 'Cached Route', slug: 'test-slug' };
    mockDbSelect.mockResolvedValue({ data: JSON.stringify(cached) });

    const result = await loadAdminContent({
      ...baseOpts,
      user: { id: 'u1', email: null, displayName: 'Test', role: 'admin' },
    });

    expect(result.data).toEqual(cached);
    expect(result.isDraft).toBe(false);
  });

  it('returns draft data when user has active draft', async () => {
    const draftData = { name: 'Draft Route', slug: 'test-slug' };
    mockFindDraft.mockResolvedValue({
      id: 'd1',
      branchName: 'drafts/test/routes/test-slug',
      prNumber: 42,
    });
    mockGetRef.mockResolvedValue('abc123');
    baseOpts.parseGitFile.mockResolvedValue(draftData);

    const result = await loadAdminContent({
      ...baseOpts,
      user: { id: 'u1', email: null, displayName: 'Test', role: 'admin' },
    });

    expect(result.data).toEqual(draftData);
    expect(result.isDraft).toBe(true);
    expect(result.draftPrNumber).toBe(42);
  });

  it('cleans up draft when branch is gone', async () => {
    mockFindDraft.mockResolvedValue({
      id: 'd1',
      branchName: 'drafts/test/routes/test-slug',
      prNumber: null,
    });
    mockGetRef.mockResolvedValue(null); // Branch deleted

    const result = await loadAdminContent({
      ...baseOpts,
      user: { id: 'u1', email: null, displayName: 'Test', role: 'admin' },
    });

    expect(mockDeleteDraft).toHaveBeenCalledWith(expect.anything(), 'd1');
    // Falls through to virtual module
    expect(result.data).toEqual({ name: 'Virtual Route', slug: 'test-slug' });
    expect(result.isDraft).toBe(false);
  });

  it('skips draft check when no user', async () => {
    const result = await loadAdminContent({
      ...baseOpts,
      user: undefined,
    });

    expect(mockFindDraft).not.toHaveBeenCalled();
    expect(result.data).toEqual({ name: 'Virtual Route', slug: 'test-slug' });
  });
});
