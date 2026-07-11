import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithGuest } from '../src/lib/guest-fetch';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchWithGuest', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('on 401, creates a guest then retries the original request', async () => {
    let targetCalls = 0;
    let guestCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/auth/guest') { guestCalls++; return jsonResponse(200, { success: true }); }
      targetCalls++;
      return targetCalls === 1 ? jsonResponse(401, { error: 'Unauthorized' }) : jsonResponse(200, { key: 'k1' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchWithGuest('/api/media/presign', { method: 'POST' });

    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(guestCalls).toBe(1);
    expect(targetCalls).toBe(2); // initial 401 + retry
  });

  it('is single-flight: a concurrent burst of 401s creates only one guest', async () => {
    let guestCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/auth/guest') {
        guestCalls++;
        await new Promise((r) => setTimeout(r, 10)); // hold so both initial 401s are in-flight
        return jsonResponse(200, { success: true });
      }
      // every initial request 401s until a guest exists; after creation, succeed
      return guestCalls === 0 ? jsonResponse(401, { error: 'Unauthorized' }) : jsonResponse(200, { ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    const [a, b] = await Promise.all([
      fetchWithGuest('/api/media/presign', { method: 'POST' }),
      fetchWithGuest('/api/media/confirm', { method: 'POST' }),
    ]);

    expect(a!.status).toBe(200);
    expect(b!.status).toBe(200);
    expect(guestCalls).toBe(1);
  });

  it('returns null when guest creation fails', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/auth/guest') return jsonResponse(404, { error: 'guests disabled' });
      return jsonResponse(401, { error: 'Unauthorized' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchWithGuest('/api/media/presign', { method: 'POST' });
    expect(res).toBeNull();
  });

  it('does not loop: if the retry still 401s, returns that 401 without minting again', async () => {
    let guestCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/auth/guest') { guestCalls++; return jsonResponse(200, { success: true }); }
      return jsonResponse(401, { error: 'Unauthorized' }); // target 401s on every attempt
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchWithGuest('/api/media/presign', { method: 'POST' });

    expect(res).not.toBeNull();
    expect(res!.status).toBe(401); // the retried 401 is returned to the caller
    expect(guestCalls).toBe(1); // minted once, no retry loop
  });

  it('calls onGuestCreated once after creating a guest on 401', async () => {
    let targetCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/auth/guest') return jsonResponse(200, { success: true });
      targetCalls++;
      return targetCalls === 1 ? jsonResponse(401, { error: 'Unauthorized' }) : jsonResponse(200, { ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    const onGuestCreated = vi.fn();
    await fetchWithGuest('/api/media/presign', { method: 'POST' }, { onGuestCreated });

    expect(onGuestCreated).toHaveBeenCalledTimes(1);
  });

  it('silent mode: mint failure returns null without navigating', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/auth/guest') return jsonResponse(404, { error: 'guests disabled' });
      return jsonResponse(401, { error: 'Unauthorized' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const location = { pathname: '/routes/x', href: '/routes/x' };
    vi.stubGlobal('window', { location });

    const res = await fetchWithGuest('/api/reactions', { method: 'POST' }, { onAuthFail: 'silent' });

    expect(res).toBeNull();
    expect(location.href).toBe('/routes/x'); // stayed put, no redirect
  });

  it('redirect mode (default): mint failure navigates to /login', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/auth/guest') return jsonResponse(404, { error: 'guests disabled' });
      return jsonResponse(401, { error: 'Unauthorized' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const location = { pathname: '/routes/x', href: '/routes/x' };
    vi.stubGlobal('window', { location });

    const res = await fetchWithGuest('/api/reactions', { method: 'POST' });

    expect(res).toBeNull();
    expect(location.href).toContain('/login');
  });

  it('silent mode: on successful mint it still retries and returns the response', async () => {
    let targetCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/auth/guest') return jsonResponse(200, { success: true });
      targetCalls++;
      return targetCalls === 1 ? jsonResponse(401, { error: 'Unauthorized' }) : jsonResponse(200, { ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    const onGuestCreated = vi.fn();
    const res = await fetchWithGuest('/api/reactions', { method: 'POST' }, { onAuthFail: 'silent', onGuestCreated });

    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(onGuestCreated).toHaveBeenCalledTimes(1);
  });
});
