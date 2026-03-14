import { describe, it, expect, vi } from 'vitest';

// Mock dependencies
const mockValidateSession = vi.fn();
vi.mock('../src/lib/env/env.service', () => ({ env: { GITHUB_TOKEN: 'test', GIT_BRANCH: 'main' } }));
vi.mock('../src/lib/auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/lib/auth')>();
  return {
    ...orig,
    validateSession: (...args: any[]) => mockValidateSession(...args),
    getWebAuthnConfig: () => ({ rpName: 'Test', rpID: 'localhost', origin: 'http://localhost' }),
    storeChallenge: vi.fn(),
  };
});
vi.mock('../src/lib/get-db', () => ({ db: () => 'mock-db' }));
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(async () => ({ challenge: 'test-challenge' })),
  verifyRegistrationResponse: vi.fn(),
}));

const { POST: upgradeOptions } = await import('../src/views/api/auth/upgrade-options');
const { POST: upgrade } = await import('../src/views/api/auth/upgrade');

function makeCookies(token?: string) {
  return {
    get: (name: string) => token && name === 'session_token' ? { value: token } : undefined,
    set: vi.fn(),
    delete: vi.fn(),
  };
}

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/auth/upgrade-options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('upgrade-options endpoint', () => {
  it('rejects requests without a session token', async () => {
    const res = await upgradeOptions({
      request: makeRequest({ email: 'test@example.com' }),
      cookies: makeCookies(),
    } as any);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Only guests can upgrade');
  });

  it('rejects non-guest users', async () => {
    mockValidateSession.mockResolvedValue({ id: 'u1', username: 'editor', role: 'editor' });
    const res = await upgradeOptions({
      request: makeRequest({ email: 'test@example.com' }),
      cookies: makeCookies('valid-token'),
    } as any);
    expect(res.status).toBe(401);
  });

  it('accepts authenticated guest users', async () => {
    mockValidateSession.mockResolvedValue({ id: 'u1', username: 'guest-123', role: 'guest' });
    const res = await upgradeOptions({
      request: makeRequest({ email: 'test@example.com' }),
      cookies: makeCookies('valid-token'),
    } as any);
    expect(res.status).toBe(200);
  });
});

describe('upgrade endpoint', () => {
  it('rejects requests without a session token', async () => {
    const res = await upgrade({
      request: makeRequest({ email: 'test@example.com', credential: {} }),
      cookies: makeCookies(),
    } as any);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Only guests can upgrade');
  });

  it('rejects non-guest users', async () => {
    mockValidateSession.mockResolvedValue({ id: 'u1', username: 'admin', role: 'admin' });
    const res = await upgrade({
      request: makeRequest({ email: 'test@example.com', credential: {} }),
      cookies: makeCookies('valid-token'),
    } as any);
    expect(res.status).toBe(401);
  });
});
