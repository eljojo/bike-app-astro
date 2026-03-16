import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// --- Mocks ---

vi.mock('../src/lib/auth/authorize', () => ({
  authorize: (_locals: unknown, _action: string) => {
    const user = (_locals as Record<string, unknown>)?.user;
    if (!user) return new Response('Unauthorized', { status: 401 });
    return user;
  },
}));

vi.mock('../src/lib/api-response', () => ({
  jsonError: (message: string, status = 400) => new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }),
}));

const mockPut = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/lib/env/env.service', () => ({
  env: {
    BUCKET: { put: (...args: unknown[]) => mockPut(...args) },
  },
}));

const editorUser = { id: 'u1', username: 'editor', role: 'editor', bannedAt: null };

function makeRequest(key: string, body: ArrayBuffer = new ArrayBuffer(8)) {
  return {
    request: new Request(`http://localhost/api/video-upload-local?key=${key}`, {
      method: 'PUT',
      body,
    }),
    url: new URL(`http://localhost/api/video-upload-local?key=${key}`),
    locals: { user: editorUser },
  } as any;
}

describe('video-upload-local PUT', () => {
  const originalRuntime = process.env.RUNTIME;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RUNTIME = 'local';
  });

  afterAll(() => {
    process.env.RUNTIME = originalRuntime;
  });

  it('rejects unauthenticated requests', async () => {
    const { PUT } = await import('../src/views/api/video-upload-local');
    const res = await PUT({
      request: new Request('http://localhost/api/video-upload-local?key=ab12cd34', { method: 'PUT' }),
      url: new URL('http://localhost/api/video-upload-local?key=ab12cd34'),
      locals: {},
    } as any);
    expect(res.status).toBe(401);
  });

  it('returns 404 when not in local runtime', async () => {
    process.env.RUNTIME = 'production';
    const { PUT } = await import('../src/views/api/video-upload-local');
    const res = await PUT(makeRequest('ab12cd34'));
    expect(res.status).toBe(404);
  });

  it('rejects invalid key format', async () => {
    const { PUT } = await import('../src/views/api/video-upload-local');
    const res = await PUT(makeRequest('invalid-key-too-long'));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Invalid key');
  });

  it('rejects missing key', async () => {
    const { PUT } = await import('../src/views/api/video-upload-local');
    const res = await PUT({
      request: new Request('http://localhost/api/video-upload-local', { method: 'PUT' }),
      url: new URL('http://localhost/api/video-upload-local'),
      locals: { user: editorUser },
    } as any);
    expect(res.status).toBe(400);
  });

  it('accepts valid 8-char key and uploads to bucket', async () => {
    const { PUT } = await import('../src/views/api/video-upload-local');
    const body = new ArrayBuffer(16);
    const res = await PUT(makeRequest('ab12cd34', body));
    expect(res.status).toBe(200);
    expect(mockPut).toHaveBeenCalledWith('ab12cd34', expect.any(ArrayBuffer));
  });

  it('accepts prefixed key format (prefix/8chars)', async () => {
    const { PUT } = await import('../src/views/api/video-upload-local');
    const res = await PUT(makeRequest('ottawa/ab12cd34'));
    expect(res.status).toBe(200);
    expect(mockPut).toHaveBeenCalledWith('ottawa/ab12cd34', expect.any(ArrayBuffer));
  });

  it('returns 500 when bucket put fails', async () => {
    mockPut.mockRejectedValueOnce(new Error('Disk full'));
    const { PUT } = await import('../src/views/api/video-upload-local');
    const res = await PUT(makeRequest('ab12cd34'));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain('Disk full');
  });
});
