import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SaveHandlers, CurrentFiles } from '../src/lib/content-save';

// Existing handler interface tests (preserved)
describe('SaveHandlers interface', () => {
  const testHandlers: SaveHandlers<{ body: string; contentHash?: string }> = {
    parseRequest: (body: unknown) => body as { body: string; contentHash?: string },
    resolveContentId: (params) => params.slug!,
    validateSlug: (slug) => slug.length < 2 ? 'Too short' : null,
    getFilePaths: (slug) => ({ primary: `test/${slug}.md` }),
    computeContentHash: (files) => `hash-${files.primaryFile?.sha || 'none'}`,
    buildFreshData: (id, files) => JSON.stringify({ id, content: files.primaryFile?.content }),
    async buildFileChanges(update, id, files) {
      return {
        files: [{ path: `test/${id}.md`, content: update.body }],
        deletePaths: [],
        isNew: !files.primaryFile,
      };
    },
    buildCommitMessage: (_update, id, isNew) => isNew ? `Create ${id}` : `Update ${id}`,
    buildGitHubUrl: (id, branch) => `https://github.com/test/repo/blob/${branch}/test/${id}.md`,
  };

  it('parseRequest returns the body', () => {
    const result = testHandlers.parseRequest({ body: 'hello', contentHash: 'abc' });
    expect(result).toEqual({ body: 'hello', contentHash: 'abc' });
  });

  it('resolveContentId extracts slug from params', () => {
    expect(testHandlers.resolveContentId({ slug: 'my-route' }, { body: '' })).toBe('my-route');
  });

  it('validateSlug rejects short slugs', () => {
    expect(testHandlers.validateSlug!('a')).toBe('Too short');
    expect(testHandlers.validateSlug!('ab')).toBeNull();
  });

  it('getFilePaths returns the correct paths', () => {
    expect(testHandlers.getFilePaths('my-route')).toEqual({
      primary: 'test/my-route.md',
    });
  });

  it('computeContentHash uses file sha', () => {
    const files: CurrentFiles = {
      primaryFile: { content: 'test', sha: '123' },
    };
    expect(testHandlers.computeContentHash(files)).toBe('hash-123');
  });

  it('buildFileChanges detects new content', async () => {
    const result = await testHandlers.buildFileChanges(
      { body: 'new content' },
      'new-slug',
      { primaryFile: null },
      {} as any,
    );
    expect(result.isNew).toBe(true);
    expect(result.files).toHaveLength(1);
  });

  it('buildFileChanges detects existing content', async () => {
    const result = await testHandlers.buildFileChanges(
      { body: 'updated' },
      'existing-slug',
      { primaryFile: { content: 'old', sha: 'abc' } },
      {} as any,
    );
    expect(result.isNew).toBe(false);
  });

  it('buildCommitMessage varies by isNew', () => {
    const files: CurrentFiles = { primaryFile: null };
    expect(testHandlers.buildCommitMessage({ body: '' }, 'test', true, files)).toBe('Create test');
    expect(testHandlers.buildCommitMessage({ body: '' }, 'test', false, files)).toBe('Update test');
  });

  it('buildGitHubUrl constructs correct URL', () => {
    expect(testHandlers.buildGitHubUrl('my-route', 'main'))
      .toBe('https://github.com/test/repo/blob/main/test/my-route.md');
  });
});

// --- New: saveContent pipeline integration tests ---

// Mock modules BEFORE importing saveContent
const mockReadFile = vi.fn();
const mockWriteFiles = vi.fn();
const mockGit = { readFile: mockReadFile, writeFiles: mockWriteFiles };

vi.mock('../src/lib/git-factory', () => ({
  createGitService: () => mockGit,
}));

vi.mock('../src/lib/env', () => ({
  env: { GIT_BRANCH: 'main', GITHUB_TOKEN: 'test-token' },
}));

// Mock D1 database with chainable methods
const mockGetResult = vi.fn((): { githubSha: string; data: string } | null => null);
const mockOnConflictDoUpdate = vi.fn();

vi.mock('../src/lib/get-db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          get: () => mockGetResult(),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: mockOnConflictDoUpdate,
      }),
    }),
  }),
}));

const { saveContent } = await import('../src/lib/content-save');

function makeRequest(body: object): Request {
  return new Request('http://localhost/api/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const adminUser = { id: 'u1', username: 'admin', email: null, role: 'admin' as const, bannedAt: null };
const bannedUser = { id: 'u2', username: 'banned', email: null, role: 'editor' as const, bannedAt: '2026-01-01' };

const stubHandlers: SaveHandlers<{ body: string; contentHash?: string }> = {
  parseRequest: (b: unknown) => b as { body: string; contentHash?: string },
  resolveContentId: (params) => params.slug!,
  getFilePaths: (slug) => ({ primary: `test/${slug}.md` }),
  computeContentHash: (files) => `hash-${files.primaryFile?.content?.length || 0}`,
  buildFreshData: (_id, files) => JSON.stringify({ body: files.primaryFile?.content }),
  async buildFileChanges(update, id, files) {
    return {
      files: [{ path: `test/${id}.md`, content: update.body }],
      deletePaths: [],
      isNew: !files.primaryFile,
    };
  },
  buildCommitMessage: (_u, id, isNew) => isNew ? `Create ${id}` : `Update ${id}`,
  buildGitHubUrl: (id, branch) => `https://github.com/test/repo/blob/${branch}/test/${id}.md`,
};

describe('saveContent pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockResolvedValue({ content: 'old body', sha: 'sha-old' });
    mockGetResult.mockReturnValue(null);
    mockWriteFiles.mockResolvedValue('sha-new');
  });

  it('happy path: git write called, D1 updated, response includes contentHash', async () => {
    const req = makeRequest({ body: 'new content' });
    const res = await saveContent(req, { user: adminUser } as any, { slug: 'my-route' }, 'routes', stubHandlers);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.sha).toBe('sha-new');
    expect(data.contentHash).toBeDefined();
    expect(mockWriteFiles).toHaveBeenCalledOnce();
    expect(mockOnConflictDoUpdate).toHaveBeenCalled();
  });

  it('banned user returns 403', async () => {
    const req = makeRequest({ body: 'spam' });
    const res = await saveContent(req, { user: bannedUser } as any, { slug: 'my-route' }, 'routes', stubHandlers);

    expect(res.status).toBe(403);
    expect(mockWriteFiles).not.toHaveBeenCalled();
  });

  it('unauthenticated user returns 401', async () => {
    const req = makeRequest({ body: 'test' });
    const res = await saveContent(req, { user: undefined } as any, { slug: 'my-route' }, 'routes', stubHandlers);
    expect(res.status).toBe(401);
  });

  it('conflict: D1 cache SHA differs from git SHA → 409', async () => {
    mockGetResult.mockReturnValue({ githubSha: 'sha-stale', data: '{}' });

    const req = makeRequest({ body: 'updated' });
    const res = await saveContent(req, { user: adminUser } as any, { slug: 'my-route' }, 'routes', stubHandlers);

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.conflict).toBe(true);
    expect(mockWriteFiles).not.toHaveBeenCalled();
  });

  it('conflict: no D1 entry, stale contentHash → 409', async () => {
    const req = makeRequest({ body: 'updated', contentHash: 'stale-hash' });
    const res = await saveContent(req, { user: adminUser } as any, { slug: 'my-route' }, 'routes', stubHandlers);

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.conflict).toBe(true);
  });

  it('no conflict: D1 cache SHA matches git SHA → 200', async () => {
    mockGetResult.mockReturnValue({ githubSha: 'sha-old', data: '{}' });

    const req = makeRequest({ body: 'updated' });
    const res = await saveContent(req, { user: adminUser } as any, { slug: 'my-route' }, 'routes', stubHandlers);

    expect(res.status).toBe(200);
    expect(mockWriteFiles).toHaveBeenCalled();
  });

  it('consecutive saves: second save uses returned contentHash without conflict', async () => {
    const req1 = makeRequest({ body: 'first edit' });
    const res1 = await saveContent(req1, { user: adminUser } as any, { slug: 'my-route' }, 'routes', stubHandlers);
    expect(res1.status).toBe(200);
    const data1 = await res1.json();

    // After first save, git has new content and D1 has the cache entry
    mockReadFile.mockResolvedValue({ content: 'first edit', sha: 'sha-new' });
    mockGetResult.mockReturnValue({ githubSha: 'sha-new', data: '{}' });

    const req2 = makeRequest({ body: 'second edit', contentHash: data1.contentHash });
    const res2 = await saveContent(req2, { user: adminUser } as any, { slug: 'my-route' }, 'routes', stubHandlers);
    expect(res2.status).toBe(200);
  });

  it('D1 cache uses in-memory content, not git re-read after commit', async () => {
    const req = makeRequest({ body: 'new content' });
    const res = await saveContent(req, { user: adminUser } as any, { slug: 'my-route' }, 'routes', stubHandlers);

    expect(res.status).toBe(200);
    expect(mockOnConflictDoUpdate).toHaveBeenCalled();
    // readFile called once in Phase 2 to read current file, NOT again after commit
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });

  it('no-change save: writeFiles not called, returns 200 with contentHash', async () => {
    mockReadFile.mockResolvedValue({ content: 'same content', sha: 'sha-existing' });

    const req = makeRequest({ body: 'same content' });
    const res = await saveContent(req, { user: adminUser } as any, { slug: 'my-route' }, 'routes', stubHandlers);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.contentHash).toBeDefined();
    expect(mockWriteFiles).not.toHaveBeenCalled();
  });

  it('new content: writeFiles called, isNew flag reflected in commit message', async () => {
    mockReadFile.mockResolvedValue(null);
    const req = makeRequest({ body: 'brand new' });
    const res = await saveContent(req, { user: adminUser } as any, { slug: 'new-route' }, 'routes', stubHandlers);

    expect(res.status).toBe(200);
    expect(mockWriteFiles).toHaveBeenCalledWith(
      [{ path: 'test/new-route.md', content: 'brand new' }],
      'Create new-route',
      expect.objectContaining({ name: 'admin' }),
      undefined,
    );
  });
});
