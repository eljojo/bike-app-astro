import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---

let findJobResult: Record<string, unknown> | null = null;
const mockUpdate = vi.fn();
const mockSelectWhere = vi.fn();
const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);

vi.mock('../src/lib/get-db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: (...args: unknown[]) => {
          mockSelectWhere(...args);
          return { get: () => findJobResult };
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        mockUpdate(values);
        return { where: (...args: unknown[]) => { mockUpdateWhere(...args); return Promise.resolve(); } };
      },
    }),
  }),
}));

vi.mock('../src/db/schema', () => ({
  videoJobs: { key: 'key' },
}));

vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ _op: 'eq', a, b }),
}));

vi.mock('../src/lib/auth/authorize', () => ({
  authorize: (_locals: unknown) => {
    const user = (_locals as Record<string, unknown>)?.user;
    if (!user) return new Response('Unauthorized', { status: 401 });
    return user;
  },
}));

vi.mock('../src/lib/config/city-config', () => ({
  getCityConfig: () => ({ videos_cdn_url: 'https://videos.example.com' }),
}));

vi.mock('../src/lib/media/video-completion', () => ({
  // Matches real pattern: ${VIDEO_PREFIX}/${key}/${key}-h264.mp4
  // VIDEO_PREFIX defaults to CITY in non-blog instances
  h264OutputKey: (key: string) => `ottawa/${key}/${key}-h264.mp4`,
}));

// Mock global fetch for CDN HEAD checks
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const editorUser = { id: 'u1', username: 'editor', role: 'editor', bannedAt: null };

describe('video-status GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findJobResult = null;
    mockFetch.mockReset();
    mockSelectWhere.mockClear();
    mockUpdateWhere.mockClear();
  });

  it('returns 404 when job not found', async () => {
    findJobResult = null;
    const { GET } = await import('../src/views/api/video-status');
    const res = await GET({
      params: { key: 'unknown' },
      locals: { user: editorUser },
    } as any);
    expect(res.status).toBe(404);
  });

  it('returns ready job immediately without CDN check', async () => {
    findJobResult = { key: 'abc12345', status: 'ready' };
    const { GET } = await import('../src/views/api/video-status');
    const res = await GET({
      params: { key: 'abc12345' },
      locals: { user: editorUser },
    } as any);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ready');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns failed job immediately without CDN check', async () => {
    findJobResult = { key: 'abc12345', status: 'failed' };
    const { GET } = await import('../src/views/api/video-status');
    const res = await GET({
      params: { key: 'abc12345' },
      locals: { user: editorUser },
    } as any);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('failed');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('self-heals: checks CDN when status is transcoding and updates to ready', async () => {
    findJobResult = { key: 'abc12345', status: 'transcoding' };
    mockFetch.mockResolvedValue({ ok: true });

    const { GET } = await import('../src/views/api/video-status');
    const res = await GET({
      params: { key: 'abc12345' },
      locals: { user: editorUser },
    } as any);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ready');
    // Self-heal no longer sets posterKey (webhook handles that)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('abc12345-h264.mp4'),
      { method: 'HEAD' },
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ready' }),
    );
  });

  it('returns current status when CDN check fails', async () => {
    findJobResult = { key: 'abc12345', status: 'transcoding' };
    mockFetch.mockResolvedValue({ ok: false });

    const { GET } = await import('../src/views/api/video-status');
    const res = await GET({
      params: { key: 'abc12345' },
      locals: { user: editorUser },
    } as any);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('transcoding');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns current status when CDN fetch throws', async () => {
    findJobResult = { key: 'abc12345', status: 'uploading' };
    mockFetch.mockRejectedValue(new Error('Network error'));

    const { GET } = await import('../src/views/api/video-status');
    const res = await GET({
      params: { key: 'abc12345' },
      locals: { user: editorUser },
    } as any);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('uploading');
  });

  it('queries videoJobs with eq(videoJobs.key, key)', async () => {
    findJobResult = { key: 'abc12345', status: 'ready' };
    const { GET } = await import('../src/views/api/video-status');
    await GET({
      params: { key: 'abc12345' },
      locals: { user: editorUser },
    } as any);
    // select().from(videoJobs).where(eq(videoJobs.key, key))
    expect(mockSelectWhere).toHaveBeenCalledWith({ _op: 'eq', a: 'key', b: 'abc12345' });
  });

  it('self-heal update uses where(eq(videoJobs.key, key))', async () => {
    findJobResult = { key: 'abc12345', status: 'transcoding' };
    mockFetch.mockResolvedValue({ ok: true });
    const { GET } = await import('../src/views/api/video-status');
    await GET({
      params: { key: 'abc12345' },
      locals: { user: editorUser },
    } as any);
    // update(videoJobs).set({...}).where(eq(videoJobs.key, key))
    expect(mockUpdateWhere).toHaveBeenCalledWith({ _op: 'eq', a: 'key', b: 'abc12345' });
  });

  it('rejects missing key param', async () => {
    const { GET } = await import('../src/views/api/video-status');
    const res = await GET({
      params: {},
      locals: { user: editorUser },
    } as any);
    expect(res.status).toBe(400);
  });
});
