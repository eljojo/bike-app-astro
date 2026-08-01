import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SaveHandlers, BuildResult } from '../src/lib/content/content-save';
import { formSubmissions } from '../src/db/schema';

// Mock modules BEFORE importing saveContent
const mockReadFile = vi.fn();
const mockWriteFiles = vi.fn();
const mockGit = { readFile: mockReadFile, writeFiles: mockWriteFiles };

vi.mock('../src/lib/git/git-factory', () => ({
  createGitService: () => mockGit,
}));

vi.mock('../src/lib/env/env.service', () => ({
  env: { GIT_BRANCH: 'main', GITHUB_TOKEN: 'test-token' },
}));

// Mock D1 database with chainable methods
const mockGetResult = vi.fn((): { githubSha: string; data: string } | null => null);
const mockOnConflictDoUpdate = vi.fn();
// Tracks db.delete(...) calls. Both the claim's stale-row cleanup and
// releaseFormSubmission delete from form_submissions, so call count
// distinguishes "claim released" (cleanup + release) from "claim kept" (cleanup
// only) in the post-commit-failure tests.
const mockDelete = vi.fn(() => ({ where: () => undefined }));
// formSubmissions inserts throw on PK conflict; tests reach into this fn
// to simulate either a successful claim or a duplicate-rejection.
const mockFormSubmissionsInsert = vi.fn(() => undefined as unknown);

vi.mock('../src/lib/get-db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          get: () => mockGetResult(),
        }),
      }),
    }),
    insert: (table: unknown) => {
      if (table === formSubmissions) {
        return { values: () => mockFormSubmissionsInsert() };
      }
      return {
        values: (v: unknown) => ({
          onConflictDoUpdate: () => mockOnConflictDoUpdate(v),
        }),
      };
    },
    update: () => ({ set: () => ({ where: () => undefined }) }),
    delete: () => mockDelete(),
  }),
}));

const { saveContent } = await import('../src/lib/content/content-save');

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

// --- Permission stripping tests ---

describe('saveContent permission stripping', () => {
  const editorUser = { id: 'u3', username: 'editor', email: null, role: 'editor' as const, bannedAt: null };
  const guestUser = { id: 'u4', username: 'guest-1234', email: null, role: 'guest' as const, bannedAt: null };

  // Handlers that capture the update as seen by buildFileChanges
  let capturedUpdate: Record<string, unknown> | null = null;

  const capturingHandlers: SaveHandlers<Record<string, unknown>> = {
    parseRequest: (b: unknown) => b as Record<string, unknown>,
    resolveContentId: (params) => params.slug!,
    getFilePaths: (slug) => ({ primary: `test/${slug}.md` }),
    computeContentHash: () => 'hash',
    buildFreshData: () => '{}',
    async buildFileChanges(update, id, files) {
      capturedUpdate = update;
      return {
        files: [{ path: `test/${id}.md`, content: 'test' }],
        deletePaths: [],
        isNew: !files.primaryFile,
      };
    },
    buildCommitMessage: (_u, id) => `Update ${id}`,
    buildGitHubUrl: (id, branch) => `https://github.com/test/repo/blob/${branch}/test/${id}.md`,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    capturedUpdate = null;
    mockReadFile.mockResolvedValue({ content: 'existing', sha: 'sha-old' });
    mockGetResult.mockReturnValue({ githubSha: 'sha-old', data: '{}' });
    mockWriteFiles.mockResolvedValue('sha-new');
  });

  it('admin user: status preserved in frontmatter', async () => {
    const req = makeRequest({
      frontmatter: { name: 'Test', status: 'draft' },
      body: 'test',
    });
    await saveContent(req, { user: adminUser } as any, { slug: 'test' }, 'routes', capturingHandlers);
    expect(capturedUpdate?.frontmatter).toMatchObject({ status: 'draft' });
  });

  it('editor user: status stripped from frontmatter', async () => {
    const req = makeRequest({
      frontmatter: { name: 'Test', status: 'draft' },
      body: 'test',
    });
    await saveContent(req, { user: editorUser } as any, { slug: 'test' }, 'routes', capturingHandlers);
    expect((capturedUpdate?.frontmatter as Record<string, unknown>)?.status).toBeUndefined();
  });

  it('guest user: status stripped from frontmatter', async () => {
    const req = makeRequest({
      frontmatter: { name: 'Test', status: 'published' },
      body: 'test',
    });
    await saveContent(req, { user: guestUser } as any, { slug: 'test' }, 'routes', capturingHandlers);
    expect((capturedUpdate?.frontmatter as Record<string, unknown>)?.status).toBeUndefined();
  });

  it('editor user: newSlug preserved', async () => {
    const req = makeRequest({
      frontmatter: { name: 'Test' },
      body: 'test',
      newSlug: 'new-slug',
    });
    await saveContent(req, { user: editorUser } as any, { slug: 'test' }, 'routes', capturingHandlers);
    expect(capturedUpdate?.newSlug).toBe('new-slug');
  });

  it('guest user: newSlug stripped', async () => {
    const req = makeRequest({
      frontmatter: { name: 'Test' },
      body: 'test',
      newSlug: 'new-slug',
    });
    await saveContent(req, { user: guestUser } as any, { slug: 'test' }, 'routes', capturingHandlers);
    expect(capturedUpdate?.newSlug).toBeUndefined();
  });

  it('admin user: newSlug preserved', async () => {
    const req = makeRequest({
      frontmatter: { name: 'Test' },
      body: 'test',
      newSlug: 'renamed',
    });
    await saveContent(req, { user: adminUser } as any, { slug: 'test' }, 'routes', capturingHandlers);
    expect(capturedUpdate?.newSlug).toBe('renamed');
  });
});

// --- afterCommit failure isolation tests ---

describe('saveContent afterCommit isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockResolvedValue({ content: 'existing', sha: 'sha-old' });
    mockGetResult.mockReturnValue({ githubSha: 'sha-old', data: '{}' });
    mockWriteFiles.mockResolvedValue('sha-new');
  });

  it('returns 200 even when afterCommit throws', async () => {
    const throwingHandlers: SaveHandlers<{ body: string; contentHash?: string }> & { afterCommit: (result: BuildResult, db: unknown) => Promise<void> } = {
      ...stubHandlers,
      afterCommit: async () => {
        throw new Error('afterCommit exploded');
      },
    };

    const req = makeRequest({ body: 'new content' });
    const res = await saveContent(req, { user: adminUser } as any, { slug: 'test' }, 'routes', throwingHandlers);

    // Git commit happened, response should be 200 despite afterCommit failure
    expect(res.status).toBe(200);
    expect(mockWriteFiles).toHaveBeenCalledOnce();
    const data = await res.json();
    expect(data.success).toBe(true);
  });
});

// --- Flat-format events get conflict detection like everything else ---
//
// Flat events live at `events/<year>/<slug>.md` (an auxiliary path) instead of
// `events/<year>/<slug>/index.md` (the primary path), so `primaryFile` is null
// even though content exists. The pipeline must resolve the effective primary
// from that auxiliary `.md` and run conflict detection + cache refresh against
// it — otherwise two editors silently last-write-wins.

describe('saveContent flat-format events', () => {
  // Effective primary = primaryFile if present, else the auxiliary `.md`.
  function effective(files: import('../src/lib/models/content-model').GitFiles) {
    if (files.primaryFile) return files.primaryFile;
    for (const [p, f] of Object.entries(files.auxiliaryFiles || {})) {
      if (f && p.endsWith('.md')) return f;
    }
    return null;
  }

  const flatEventHandlers: SaveHandlers<{ body: string; contentHash?: string }> = {
    parseRequest: (b: unknown) => b as { body: string; contentHash?: string },
    resolveContentId: (params) => params.slug!,
    getFilePaths: (id) => ({
      primary: `events/${id}/index.md`,
      auxiliary: [`events/${id}.md`, `events/${id}/media.yml`],
    }),
    computeContentHash: (files) => `hash-${effective(files)?.content?.length || 0}`,
    buildFreshData: (_id, files) => JSON.stringify({ body: effective(files)?.content }),
    async buildFileChanges(update, id, files) {
      return {
        // Flat events commit to the sibling `.md`, never the directory index.md.
        files: [{ path: `events/${id}.md`, content: update.body }],
        deletePaths: [],
        isNew: !effective(files),
      };
    },
    buildCommitMessage: (_u, id, isNew) => isNew ? `Create ${id}` : `Update ${id}`,
    buildGitHubUrl: (id, branch) => `https://github.com/test/repo/blob/${branch}/events/${id}.md`,
  };

  const eventId = '2026/audax-200';

  beforeEach(() => {
    vi.clearAllMocks();
    // index.md (primary) does not exist; the flat sibling holds the content.
    mockReadFile.mockImplementation((path: string) => {
      if (path === `events/${eventId}.md`) {
        return Promise.resolve({ content: 'old flat body', sha: 'sha-flat' });
      }
      return Promise.resolve(null); // index.md and media.yml
    });
    mockGetResult.mockReturnValue(null);
    mockWriteFiles.mockResolvedValue('sha-new');
  });

  it('stale D1 githubSha → 409 conflict (no silent last-write-wins)', async () => {
    // D1 remembers a SHA that no longer matches the flat file on git.
    mockGetResult.mockReturnValue({ githubSha: 'sha-stale', data: '{}' });

    const req = makeRequest({ body: 'my edit' });
    const res = await saveContent(req, { user: adminUser } as any, { slug: eventId }, 'events', flatEventHandlers);

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.conflict).toBe(true);
    expect(mockWriteFiles).not.toHaveBeenCalled();
  });

  it('save refreshes D1 cache and response carries a contentHash', async () => {
    // D1 SHA matches the flat file → no conflict, commit proceeds.
    mockGetResult.mockReturnValue({ githubSha: 'sha-flat', data: '{}' });

    const req = makeRequest({ body: 'new flat body' });
    const res = await saveContent(req, { user: adminUser } as any, { slug: eventId }, 'events', flatEventHandlers);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.contentHash).toBeDefined();
    expect(mockWriteFiles).toHaveBeenCalledOnce();
    // Cache upsert ran against the committed flat file, not skipped.
    expect(mockOnConflictDoUpdate).toHaveBeenCalled();
  });
});

describe('saveContent form_instance_id rejection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockResolvedValue(null); // new content
    mockGetResult.mockReturnValue(null);
    mockFormSubmissionsInsert.mockReturnValue(undefined);
    mockWriteFiles.mockResolvedValue('sha-new');
  });

  it('first /new POST claims the form_instance_id and creates the event', async () => {
    const req = makeRequest({ body: 'hello', form_instance_id: 'fi-fresh' });
    const res = await saveContent(req, { user: adminUser } as any, { slug: 'new' }, 'events', stubHandlers);

    expect(res.status).toBe(200);
    expect(mockWriteFiles).toHaveBeenCalledTimes(1);
  });

  it('second /new POST with the same form_instance_id is rejected with 409 and never writes', async () => {
    // Simulate the PK conflict that the second insert would hit.
    mockFormSubmissionsInsert.mockImplementation(() => {
      throw new Error('UNIQUE constraint failed: form_submissions.form_instance_id');
    });

    const req = makeRequest({ body: 'hello', form_instance_id: 'fi-already-used' });
    const res = await saveContent(req, { user: adminUser } as any, { slug: 'new' }, 'events', stubHandlers);

    expect(res.status).toBe(409);
    expect(mockWriteFiles).not.toHaveBeenCalled();
  });

  it('two /new POSTs with DIFFERENT form_instance_ids both succeed (admin duplicate-event flow preserved)', async () => {
    const req1 = makeRequest({ body: 'a', form_instance_id: 'fi-one' });
    const res1 = await saveContent(req1, { user: adminUser } as any, { slug: 'new' }, 'events', stubHandlers);
    expect(res1.status).toBe(200);

    mockReadFile.mockResolvedValue({ content: 'a', sha: 'sha-new' });
    mockGetResult.mockReturnValue({ githubSha: 'sha-new', data: '{}' });

    const req2 = makeRequest({ body: 'b', form_instance_id: 'fi-two' });
    const res2 = await saveContent(req2, { user: adminUser } as any, { slug: 'new' }, 'events', stubHandlers);
    expect(res2.status).toBe(200);

    expect(mockWriteFiles).toHaveBeenCalledTimes(2);
  });

  it('update path (slug !== "new") never claims a form_submission, even if form_instance_id is sent', async () => {
    // Simulate file already exists with matching sha so the update path
    // proceeds. If the rejection check were applied here, this would 409.
    mockReadFile.mockResolvedValue({ content: 'old', sha: 'sha-old' });
    mockGetResult.mockReturnValue({ githubSha: 'sha-old', data: '{}' });

    // Even if form_instance_id is set and would conflict, an update must succeed.
    mockFormSubmissionsInsert.mockImplementation(() => {
      throw new Error('UNIQUE constraint failed');
    });

    const req = makeRequest({ body: 'updated', form_instance_id: 'fi-stale' });
    const res = await saveContent(req, { user: adminUser } as any, { slug: 'existing-event' }, 'events', stubHandlers);

    expect(res.status).toBe(200);
    expect(mockFormSubmissionsInsert).not.toHaveBeenCalled();
  });
});

// --- Commit landed → never a client-visible 500 that invites a duplicating retry ---

describe('saveContent post-commit durability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockResolvedValue(null); // new content (create flow)
    mockGetResult.mockReturnValue(null);
    mockFormSubmissionsInsert.mockReturnValue(undefined);
    mockWriteFiles.mockResolvedValue('sha-new');
    // clearAllMocks leaves implementations in place, so reset the throwing
    // seams other tests install back to no-ops.
    mockOnConflictDoUpdate.mockReset();
    mockDelete.mockReset();
    mockDelete.mockImplementation(() => ({ where: () => undefined }));
  });

  it('D1 cache write throws AFTER the commit lands: 200 with hash, claim kept, commit once even on retry', async () => {
    // The git commit has already landed when the post-commit cache upsert blows
    // up. The response must stay 200 (git is the source of truth) and the claim
    // must NOT be released.
    mockOnConflictDoUpdate.mockImplementation(() => {
      throw new Error('D1 unavailable');
    });

    const req = makeRequest({ body: 'hello', form_instance_id: 'fi-cache-down' });
    const res = await saveContent(req, { user: adminUser } as any, { slug: 'new' }, 'events', stubHandlers);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.contentHash).toBeDefined();
    expect(mockWriteFiles).toHaveBeenCalledTimes(1);
    // Claim NOT released: the only delete is the claim's stale-row cleanup.
    // (A release would add a second delete.)
    expect(mockDelete).toHaveBeenCalledTimes(1);

    // The client retries with the SAME form_instance_id. Because the claim was
    // kept, the re-claim conflicts → 409, and no second commit happens: one
    // logical create stays one committed file (no slug-2).
    mockFormSubmissionsInsert.mockImplementation(() => {
      throw new Error('UNIQUE constraint failed: form_submissions.form_instance_id');
    });
    const retry = makeRequest({ body: 'hello', form_instance_id: 'fi-cache-down' });
    const retryRes = await saveContent(retry, { user: adminUser } as any, { slug: 'new' }, 'events', stubHandlers);

    expect(retryRes.status).toBe(409);
    expect(mockWriteFiles).toHaveBeenCalledTimes(1);
  });

  it('pre-commit failure: 500, claim released, and a retry with the same id succeeds', async () => {
    const explodingHandlers: SaveHandlers<{ body: string; contentHash?: string }> = {
      ...stubHandlers,
      async buildFileChanges() {
        throw new Error('build blew up before commit');
      },
    };

    const req = makeRequest({ body: 'hello', form_instance_id: 'fi-precommit' });
    const res = await saveContent(req, { user: adminUser } as any, { slug: 'new' }, 'events', explodingHandlers);

    expect(res.status).toBe(500);
    expect(mockWriteFiles).not.toHaveBeenCalled();
    // Claim released: claim cleanup delete + release delete = 2 delete calls.
    expect(mockDelete).toHaveBeenCalledTimes(2);

    // The freed claim lets a retry with the same id proceed to a real commit.
    mockReadFile.mockResolvedValue(null);
    mockFormSubmissionsInsert.mockReturnValue(undefined);
    const retry = makeRequest({ body: 'hello', form_instance_id: 'fi-precommit' });
    const retryRes = await saveContent(retry, { user: adminUser } as any, { slug: 'new' }, 'events', stubHandlers);

    expect(retryRes.status).toBe(200);
    expect(mockWriteFiles).toHaveBeenCalledTimes(1);
  });
});
