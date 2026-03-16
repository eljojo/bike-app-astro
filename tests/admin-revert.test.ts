import { describe, it, expect, vi, beforeEach } from 'vitest';
import { routeDetailFromGit } from '../src/lib/models/route-model.server';
import { routeDetailToCache } from '../src/lib/models/route-model';
import { CITY } from '../src/lib/config/config';

// --- Mocks for admin-revert endpoint ---

const mockWriteFiles = vi.fn().mockResolvedValue('new-sha-abc');
const mockReadFile = vi.fn();
const mockGetCommitFiles = vi.fn();
const mockGetFileAtCommit = vi.fn();

vi.mock('../src/lib/git/git-factory', () => ({
  createGitService: () => ({
    writeFiles: mockWriteFiles,
    readFile: mockReadFile,
    getCommitFiles: mockGetCommitFiles,
    getFileAtCommit: mockGetFileAtCommit,
  }),
}));

vi.mock('../src/lib/env/env.service', () => ({
  env: {
    GITHUB_TOKEN: 'test-token',
    GIT_OWNER: 'test-owner',
    GIT_DATA_REPO: 'test-repo',
    GIT_BRANCH: 'main',
  },
}));

// eslint-disable-next-line bike-app/no-hardcoded-city-locale -- mock definition
vi.mock('../src/lib/config/config', () => ({ CITY: 'ottawa' }));

vi.mock('../src/lib/get-db', () => ({
  db: () => ({}),
}));

const mockUpsertContentCache = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/lib/content/cache', () => ({
  upsertContentCache: (...args: unknown[]) => mockUpsertContentCache(...args),
}));

vi.mock('../src/lib/auth/authorize', () => ({
  authorize: (_locals: unknown, _action: string) => {
    const user = (_locals as Record<string, unknown>)?.user;
    if (!user) return new Response('Unauthorized', { status: 401 });
    if ((user as Record<string, unknown>).role !== 'admin') {
      return new Response('Forbidden', { status: 403 });
    }
    return user;
  },
}));

vi.mock('../src/lib/api-response', () => ({
  jsonResponse: (data: unknown) => new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }),
  jsonError: (message: string, status = 400) => new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }),
}));

const mockReadCurrentState = vi.fn().mockResolvedValue({
  primaryFile: { content: '---\nname: Test\n---\n', sha: 'sha-456' },
  auxiliaryFiles: {},
});
vi.mock('../src/lib/content/content-save', () => ({
  readCurrentState: (...args: unknown[]) => mockReadCurrentState(...args),
}));

const mockBuildFreshData = vi.fn().mockReturnValue('{"name":"Test"}');
vi.mock('../src/lib/content/content-types.server', () => ({
  contentTypes: [
    {
      name: 'routes',
      ops: {
        getFilePaths: (slug: string) => ({
          primary: `${CITY}/routes/${slug}/index.md`,
          auxiliary: [`${CITY}/routes/${slug}/media.yml`],
        }),
        computeContentHash: () => 'hash-123',
        buildFreshData: (...args: unknown[]) => mockBuildFreshData(...args),
      },
    },
  ],
}));

const adminUser = { id: 'u1', username: 'admin', role: 'admin', bannedAt: null };
const editorUser = { id: 'u2', username: 'editor', role: 'editor', bannedAt: null };

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/admin-revert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('revert cache serialization (via route model)', () => {
  it('includes all media types when building cache for routes', () => {
    const frontmatter = { name: 'Test', status: 'published', distance_km: 10 };
    const body = 'description';
    const mediaYml = [
      '- type: photo',
      '  key: photo1',
      '  caption: Nice',
      '- type: video',
      '  key: vid1',
      '  title: Ride',
      '  duration: "3:00"',
    ].join('\n');

    const detail = routeDetailFromGit('test-route', frontmatter, body, mediaYml);
    const cached = routeDetailToCache(detail);
    const parsed = JSON.parse(cached);

    expect(parsed.media).toHaveLength(2);
    expect(parsed.media[0].key).toBe('photo1');
    expect(parsed.media[1].key).toBe('vid1');
    expect(parsed.media[1].type).toBe('video');
    expect(parsed.media[1].title).toBe('Ride');
  });
});

describe('admin-revert POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects non-admin users', async () => {
    const { POST } = await import('../src/views/api/admin-revert');
    const res = await POST({
      request: makeRequest({ commitSha: 'abc123', contentPath: `${CITY}/routes/test/index.md` }),
      locals: { user: editorUser },
      params: {},
    } as any);
    expect(res.status).toBe(403);
  });

  it('rejects missing commitSha', async () => {
    const { POST } = await import('../src/views/api/admin-revert');
    const res = await POST({
      request: makeRequest({ contentPath: `${CITY}/routes/test/index.md` }),
      locals: { user: adminUser },
      params: {},
    } as any);
    expect(res.status).toBe(400);
  });

  it('rejects missing contentPath', async () => {
    const { POST } = await import('../src/views/api/admin-revert');
    const res = await POST({
      request: makeRequest({ commitSha: 'abc123' }),
      locals: { user: adminUser },
      params: {},
    } as any);
    expect(res.status).toBe(400);
  });

  it('returns error when commit has no files', async () => {
    mockGetCommitFiles.mockResolvedValue([]);
    const { POST } = await import('../src/views/api/admin-revert');
    const res = await POST({
      request: makeRequest({ commitSha: 'abc123', contentPath: `${CITY}/routes/test/index.md` }),
      locals: { user: adminUser },
      params: {},
    } as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Could not read files');
  });

  it('returns success without writing when content already matches', async () => {
    mockGetCommitFiles.mockResolvedValue([`${CITY}/routes/test/index.md`]);
    mockGetFileAtCommit.mockResolvedValue({ content: 'same content' });
    mockReadFile.mockResolvedValue({ content: 'same content', sha: 'sha-x' });

    const { POST } = await import('../src/views/api/admin-revert');
    const res = await POST({
      request: makeRequest({ commitSha: 'abc123', contentPath: `${CITY}/routes/test/index.md` }),
      locals: { user: adminUser },
      params: {},
    } as any);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toContain('already matches');
    expect(mockWriteFiles).not.toHaveBeenCalled();
  });

  it('restores files and rebuilds cache for known content type', async () => {
    mockGetCommitFiles.mockResolvedValue([`${CITY}/routes/test/index.md`]);
    mockGetFileAtCommit.mockResolvedValue({ content: 'old content' });
    mockReadFile.mockResolvedValue({ content: 'new content', sha: 'sha-x' });

    const { POST } = await import('../src/views/api/admin-revert');
    const res = await POST({
      request: makeRequest({ commitSha: 'abc123', contentPath: `${CITY}/routes/test/index.md` }),
      locals: { user: adminUser },
      params: {},
    } as any);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.sha).toBe('new-sha-abc');
    expect(mockWriteFiles).toHaveBeenCalledWith(
      [{ path: `${CITY}/routes/test/index.md`, content: 'old content' }],
      expect.stringContaining('Restore'),
      expect.objectContaining({ name: 'admin' }),
      undefined,
    );
    // Verify cache rebuild pipeline: readCurrentState called with correct file paths
    expect(mockReadCurrentState).toHaveBeenCalledWith(
      expect.anything(), // git service
      expect.objectContaining({
        primary: `${CITY}/routes/test/index.md`,
        auxiliary: expect.arrayContaining([`${CITY}/routes/test/media.yml`]),
      }),
    );
    // buildFreshData receives the slug and current files
    expect(mockBuildFreshData).toHaveBeenCalledWith('test', expect.objectContaining({
      primaryFile: expect.objectContaining({ sha: 'sha-456' }),
    }));
    expect(mockUpsertContentCache).toHaveBeenCalledWith(
      expect.anything(), // database
      expect.objectContaining({
        contentType: 'routes',
        contentSlug: 'test',
        data: '{"name":"Test"}',
        githubSha: 'sha-456',
      }),
    );
  });

  it('restores multiple files changed by the commit', async () => {
    mockGetCommitFiles.mockResolvedValue([
      `${CITY}/routes/test/index.md`,
      `${CITY}/routes/test/media.yml`,
    ]);
    mockGetFileAtCommit.mockImplementation((_sha: string, path: string) =>
      Promise.resolve({ content: `content of ${path}` }),
    );
    mockReadFile.mockResolvedValue({ content: 'different', sha: 'sha-x' });

    const { POST } = await import('../src/views/api/admin-revert');
    const res = await POST({
      request: makeRequest({ commitSha: 'abc123', contentPath: `${CITY}/routes/test/index.md` }),
      locals: { user: adminUser },
      params: {},
    } as any);
    expect(res.status).toBe(200);
    expect(mockWriteFiles).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ path: `${CITY}/routes/test/index.md` }),
        expect.objectContaining({ path: `${CITY}/routes/test/media.yml` }),
      ]),
      expect.any(String),
      expect.any(Object),
      undefined,
    );
  });

  it('returns 500 when git write fails', async () => {
    mockGetCommitFiles.mockResolvedValue([`${CITY}/routes/test/index.md`]);
    mockGetFileAtCommit.mockResolvedValue({ content: 'old content' });
    mockReadFile.mockResolvedValue({ content: 'different', sha: 'sha-x' });
    mockWriteFiles.mockRejectedValueOnce(new Error('Git API error'));

    const { POST } = await import('../src/views/api/admin-revert');
    const res = await POST({
      request: makeRequest({ commitSha: 'abc123', contentPath: `${CITY}/routes/test/index.md` }),
      locals: { user: adminUser },
      params: {},
    } as any);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain('Git API error');
  });
});
