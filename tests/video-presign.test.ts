import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---

const mockHeadObject = vi.fn().mockResolvedValue(false);
const mockPresignUpload = vi.fn().mockResolvedValue('https://s3.example.com/upload');

vi.mock('../src/lib/media/transcode.service', () => ({
  createTranscodeService: () => ({
    headObject: mockHeadObject,
    presignUpload: mockPresignUpload,
  }),
}));

vi.mock('../src/lib/media/storage.adapter-r2', () => ({
  randomKey: () => 'k3eovg6o',
}));

const mockInsertValues = vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn() });
const mockCheckRateLimit = vi.fn().mockResolvedValue(false);
const mockRecordAttempt = vi.fn().mockResolvedValue(undefined);

vi.mock('../src/lib/get-db', () => ({
  db: () => ({
    insert: () => ({ values: mockInsertValues }),
  }),
}));

vi.mock('../src/db/schema', () => ({
  videoJobs: { key: 'key' },
}));

vi.mock('../src/lib/env/env.service', () => ({
  env: {},
}));

vi.mock('../src/lib/auth/authorize', () => ({
  authorize: (_locals: unknown, _action: string) => {
    const user = (_locals as Record<string, unknown>)?.user as Record<string, unknown> | undefined;
    if (!user) return new Response('Unauthorized', { status: 401 });
    return user;
  },
}));

vi.mock('../src/lib/auth/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  recordAttempt: (...args: unknown[]) => mockRecordAttempt(...args),
  cleanupOldAttempts: () => Promise.resolve(),
  LIMITS: { editor: 10, guest: 5 },
}));

function makeRequest(body: object): Request {
  return new Request('https://example.com/api/video-presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const editorUser = { id: 'u1', username: 'editor', role: 'editor', bannedAt: null };

describe('video-presign POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHeadObject.mockResolvedValue(false);
    mockCheckRateLimit.mockResolvedValue(false);
  });

  it('rejects invalid video content type', async () => {
    const { POST } = await import('../src/views/api/video-presign');
    const req = makeRequest({ contentType: 'video/avi', contentSlug: 'test-route' });
    const res = await POST({ request: req, locals: { user: editorUser } } as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Invalid video type');
  });

  it('accepts video/mp4', async () => {
    const { POST } = await import('../src/views/api/video-presign');
    const req = makeRequest({ contentType: 'video/mp4', contentSlug: 'test-route' });
    const res = await POST({ request: req, locals: { user: editorUser } } as any);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.key).toBe('k3eovg6o');
    expect(data.uploadUrl).toBeDefined();
  });

  it('accepts video/quicktime', async () => {
    const { POST } = await import('../src/views/api/video-presign');
    const req = makeRequest({ contentType: 'video/quicktime', contentSlug: 'route' });
    const res = await POST({ request: req, locals: { user: editorUser } } as any);
    expect(res.status).toBe(200);
  });

  it('rejects oversized video', async () => {
    const { POST } = await import('../src/views/api/video-presign');
    const req = makeRequest({
      contentType: 'video/mp4',
      contentLength: 600 * 1024 * 1024,
      contentSlug: 'test',
    });
    const res = await POST({ request: req, locals: { user: editorUser } } as any);
    expect(res.status).toBe(413);
  });

  it('rejects missing contentSlug', async () => {
    const { POST } = await import('../src/views/api/video-presign');
    const req = makeRequest({ contentType: 'video/mp4' });
    const res = await POST({ request: req, locals: { user: editorUser } } as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('contentSlug');
  });

  it('returns 429 when rate limited', async () => {
    mockCheckRateLimit.mockResolvedValue(true);
    const { POST } = await import('../src/views/api/video-presign');
    const req = makeRequest({ contentType: 'video/mp4', contentSlug: 'test' });
    const res = await POST({ request: req, locals: { user: editorUser } } as any);
    expect(res.status).toBe(429);
  });

  it('inserts videoJobs row with correct fields', async () => {
    const { POST } = await import('../src/views/api/video-presign');
    const req = makeRequest({
      contentType: 'video/mp4',
      contentSlug: 'my-route',
      contentKind: 'ride',
      filename: 'morning-ride.mp4',
    });
    const res = await POST({ request: req, locals: { user: editorUser } } as any);
    expect(res.status).toBe(200);
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'k3eovg6o',
        contentKind: 'ride',
        contentSlug: 'my-route',
        status: 'uploading',
        title: 'morning-ride', // extension stripped
      }),
    );
  });

  it('defaults contentKind to route for unknown values', async () => {
    const { POST } = await import('../src/views/api/video-presign');
    const req = makeRequest({
      contentType: 'video/mp4',
      contentSlug: 'test',
      contentKind: 'unknown',
    });
    const res = await POST({ request: req, locals: { user: editorUser } } as any);
    expect(res.status).toBe(200);
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ contentKind: 'route' }),
    );
  });

  it('rejects unauthenticated request', async () => {
    const { POST } = await import('../src/views/api/video-presign');
    const req = makeRequest({ contentType: 'video/mp4', contentSlug: 'test' });
    const res = await POST({ request: req, locals: {} } as any);
    expect(res.status).toBe(401);
  });

  it('rejects invalid JSON body', async () => {
    const { POST } = await import('../src/views/api/video-presign');
    const req = new Request('https://example.com/api/video-presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    const res = await POST({ request: req, locals: { user: editorUser } } as any);
    expect(res.status).toBe(400);
  });
});
