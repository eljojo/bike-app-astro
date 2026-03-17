import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock env with WEBHOOK_SECRET
vi.mock('../src/lib/env/env.service', () => ({
  env: { WEBHOOK_SECRET: 'test-secret-token' },
}));

// Track DB operations
const mockJob = { id: 1, key: 'abc12345', status: 'uploading' };
let lastUpdate: Record<string, unknown> | null = null;
let findJobResult: typeof mockJob | null = mockJob;

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
        lastUpdate = values;
        return {
          where: () => Promise.resolve(),
        };
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

const mockPersist = vi.fn().mockResolvedValue({ persisted: true, reason: 'ok' });
vi.mock('../src/lib/media/video-completion.webhook', () => ({
  persistVideoMetadataToGit: mockPersist,
}));

function makeRequest(body: Record<string, unknown>, token?: string): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return new Request('https://example.com/api/video/webhook', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('video-webhook', () => {
  beforeEach(() => {
    lastUpdate = null;
    findJobResult = { ...mockJob };
    mockPersist.mockClear();
  });

  it('returns 401 without bearer token', async () => {
    const { POST } = await import('../src/views/api/video-webhook');
    const request = makeRequest({ key: 'abc12345', status: 'transcoding' });
    const res = await POST({ request } as never);
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong bearer token', async () => {
    const { POST } = await import('../src/views/api/video-webhook');
    const request = makeRequest({ key: 'abc12345', status: 'transcoding' }, 'wrong-token');
    const res = await POST({ request } as never);
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown video key', async () => {
    findJobResult = null;
    const { POST } = await import('../src/views/api/video-webhook');
    const request = makeRequest({ key: 'unknown', status: 'transcoding' }, 'test-secret-token');
    const res = await POST({ request } as never);
    expect(res.status).toBe(404);
  });

  it('updates video job with metadata on transcoding status', async () => {
    const { POST } = await import('../src/views/api/video-webhook');
    const request = makeRequest({
      key: 'abc12345',
      status: 'transcoding',
      width: 1920,
      height: 1080,
      duration: 'PT120S',
      orientation: 'landscape',
      jobId: 'mc-job-123',
    }, 'test-secret-token');

    const res = await POST({ request } as never);
    expect(res.status).toBe(200);
    expect(lastUpdate).toMatchObject({
      status: 'transcoding',
      width: 1920,
      height: 1080,
      duration: 'PT120S',
      orientation: 'landscape',
      jobId: 'mc-job-123',
    });
  });

  it('updates video job on ready status', async () => {
    const { POST } = await import('../src/views/api/video-webhook');
    const request = makeRequest({
      key: 'abc12345',
      status: 'ready',
    }, 'test-secret-token');

    const res = await POST({ request } as never);
    expect(res.status).toBe(200);
    expect(mockPersist).toHaveBeenCalledWith('abc12345');
  });

  it('updates video job on failed status', async () => {
    const { POST } = await import('../src/views/api/video-webhook');
    const request = makeRequest({
      key: 'abc12345',
      status: 'failed',
    }, 'test-secret-token');

    const res = await POST({ request } as never);
    expect(res.status).toBe(200);
    expect(lastUpdate).toMatchObject({ status: 'failed' });
  });
});
