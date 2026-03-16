import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---

let findJobResult: Record<string, unknown> | null = null;
const mockUpdate = vi.fn();

vi.mock('../src/lib/get-db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          get: () => findJobResult,
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        mockUpdate(values);
        return { where: () => Promise.resolve() };
      },
    }),
  }),
}));

vi.mock('../src/db/schema', () => ({
  videoJobs: { key: 'key' },
}));

vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ a, b }),
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
  posterKeyForVideo: (key: string) => `ottawa/${key}/${key}-poster.0000000.jpg`,
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
    findJobResult = { key: 'abc12345', status: 'ready', posterKey: 'poster.jpg' };
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
    expect(data.posterKey).toBeDefined();
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

  it('rejects missing key param', async () => {
    const { GET } = await import('../src/views/api/video-status');
    const res = await GET({
      params: {},
      locals: { user: editorUser },
    } as any);
    expect(res.status).toBe(400);
  });
});
