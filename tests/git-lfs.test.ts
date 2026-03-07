import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildLfsPointer, uploadToLfs } from '../src/lib/git-lfs';

describe('buildLfsPointer', () => {
  it('generates correct LFS pointer format', () => {
    const pointer = buildLfsPointer('abc123def456', 1234);
    expect(pointer).toBe(
      'version https://git-lfs.github.com/spec/v1\n' +
      'oid sha256:abc123def456\n' +
      'size 1234\n'
    );
  });
});

describe('uploadToLfs', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(responses: Array<{ ok: boolean; status?: number; body?: any; text?: string }>) {
    let callIndex = 0;
    globalThis.fetch = vi.fn(async () => {
      const resp = responses[callIndex++];
      return {
        ok: resp.ok,
        status: resp.status || (resp.ok ? 200 : 500),
        statusText: resp.ok ? 'OK' : 'Error',
        json: async () => resp.body,
        text: async () => resp.text || JSON.stringify(resp.body || {}),
      } as Response;
    });
  }

  it('batch API auth error → throws', async () => {
    mockFetch([{ ok: false, status: 401, text: 'Unauthorized' }]);
    await expect(uploadToLfs('token', 'owner', 'repo', 'content'))
      .rejects.toThrow('LFS batch API error: 401');
  });

  it('object error in batch response → throws', async () => {
    mockFetch([{
      ok: true,
      body: { objects: [{ error: { message: 'Object too large' } }] },
    }]);
    await expect(uploadToLfs('token', 'owner', 'repo', 'content'))
      .rejects.toThrow('LFS object error: Object too large');
  });

  it('object already exists (no actions) → no PUT, returns pointer', async () => {
    mockFetch([{
      ok: true,
      body: { objects: [{ oid: 'abc', size: 7 }] },
    }]);
    const pointer = await uploadToLfs('token', 'owner', 'repo', 'content');
    expect(pointer).toContain('version https://git-lfs.github.com/spec/v1');
    expect(pointer).toContain('oid sha256:');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('upload fails → throws', async () => {
    mockFetch([
      { ok: true, body: { objects: [{ actions: { upload: { href: 'https://lfs.example.com/upload' } } }] } },
      { ok: false, status: 500 },
    ]);
    await expect(uploadToLfs('token', 'owner', 'repo', 'content'))
      .rejects.toThrow('LFS upload failed: 500');
  });

  it('happy path: batch → PUT → verify → returns pointer', async () => {
    mockFetch([
      {
        ok: true,
        body: {
          objects: [{
            actions: {
              upload: { href: 'https://lfs.example.com/upload', header: { 'X-Custom': 'val' } },
              verify: { href: 'https://lfs.example.com/verify', header: { 'Authorization': 'RemoteAuth xyz' } },
            },
          }],
        },
      },
      { ok: true },
      { ok: true },
    ]);

    const pointer = await uploadToLfs('token', 'owner', 'repo', 'gpx-content');
    expect(pointer).toContain('version https://git-lfs.github.com/spec/v1');
    expect(pointer).toContain('oid sha256:');
    expect(pointer).toContain('size ');
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);

    // Verify action's header overrides our default Basic auth
    const verifyCall = (globalThis.fetch as any).mock.calls[2];
    expect(verifyCall[1].headers['Authorization']).toBe('RemoteAuth xyz');
  });

  it('verify failure → throws', async () => {
    mockFetch([
      {
        ok: true,
        body: {
          objects: [{
            actions: {
              upload: { href: 'https://lfs.example.com/upload' },
              verify: { href: 'https://lfs.example.com/verify' },
            },
          }],
        },
      },
      { ok: true },
      { ok: false, status: 403 },
    ]);

    await expect(uploadToLfs('token', 'owner', 'repo', 'gpx-content'))
      .rejects.toThrow('LFS verify failed: 403');
  });

  it('happy path without verify endpoint → 2 fetches', async () => {
    mockFetch([
      {
        ok: true,
        body: {
          objects: [{
            actions: { upload: { href: 'https://lfs.example.com/upload' } },
          }],
        },
      },
      { ok: true },
    ]);

    const pointer = await uploadToLfs('token', 'owner', 'repo', 'data');
    expect(pointer).toContain('version https://git-lfs.github.com/spec/v1');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
