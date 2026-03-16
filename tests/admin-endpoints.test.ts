import { describe, it, expect, vi } from 'vitest';

// Mock shared dependencies
vi.mock('../src/lib/get-db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        orderBy: () => [],
        where: () => ({ limit: () => [] }),
      }),
    }),
    insert: () => ({
      values: () => ({ onConflictDoUpdate: vi.fn() }),
    }),
  }),
}));

vi.mock('../src/lib/env/env.service', () => ({
  env: { GIT_BRANCH: 'main', GITHUB_TOKEN: 'test' },
}));

vi.mock('../src/lib/git/git-factory', () => ({
  createGitService: () => ({
    readFile: vi.fn(),
    writeFiles: vi.fn(),
    getFileAtCommit: vi.fn(),
    listCommits: vi.fn(() => []),
  }),
}));

vi.mock('../src/lib/auth/ban-service', () => ({
  banUser: vi.fn(),
  unbanUser: vi.fn(),
}));

const editorUser = { id: 'u1', username: 'editor', role: 'editor', bannedAt: null };
const adminUser = { id: 'u2', username: 'admin', role: 'admin', bannedAt: null };

function makeRequest(body: object): Request {
  return new Request('http://localhost/api/admin/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('admin endpoint guards enforce role-specific access (I-5)', () => {
  it('admin-users GET rejects editor', async () => {
    const { GET } = await import('../src/views/api/admin-users');
    const res = await GET({ locals: { user: editorUser } } as any);
    expect(res.status).toBe(403);
  });

  it('admin-users POST rejects editor', async () => {
    const { POST } = await import('../src/views/api/admin-users');
    const res = await POST({
      request: makeRequest({ action: 'ban', userId: 'x' }),
      locals: { user: editorUser },
    } as any);
    expect(res.status).toBe(403);
  });

  it('admin-history POST allows editor', async () => {
    const { POST } = await import('../src/views/api/admin-history');
    const res = await POST({
      request: makeRequest({ path: 'ottawa/routes' }),
      locals: { user: editorUser },
    } as any);
    expect(res.status).toBe(200);
  });

  it('admin-revert POST rejects editor', async () => {
    const { POST } = await import('../src/views/api/admin-revert');
    const res = await POST({
      request: makeRequest({ commitSha: 'abc', contentPath: 'test.md' }),
      locals: { user: editorUser },
    } as any);
    expect(res.status).toBe(403);
  });
});

describe('admin-revert input validation (I-6)', () => {
  it('rejects request missing commitSha', async () => {
    const { POST } = await import('../src/views/api/admin-revert');
    const res = await POST({
      request: makeRequest({ contentPath: 'test.md' }),
      locals: { user: adminUser },
    } as any);
    expect(res.status).toBe(400);
  });

  it('rejects request missing contentPath', async () => {
    const { POST } = await import('../src/views/api/admin-revert');
    const res = await POST({
      request: makeRequest({ commitSha: 'abc123' }),
      locals: { user: adminUser },
    } as any);
    expect(res.status).toBe(400);
  });
});
