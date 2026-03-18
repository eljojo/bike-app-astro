import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Astro runtime module
vi.mock('astro:middleware', () => ({
  defineMiddleware: (fn: any) => fn,
}));

// Mock dependencies before importing middleware
const mockValidateSession = vi.fn();
vi.mock('../src/lib/auth/auth', () => ({
  validateSession: (...args: any[]) => mockValidateSession(...args),
  ANONYMOUS_USER: {
    id: '',
    username: '',
    email: null,
    role: 'guest',
    bannedAt: null,
    emailInCommits: false,
    analyticsOptOut: false,
  },
}));
vi.mock('../src/lib/get-db', () => ({
  db: () => 'mock-db',
}));
vi.mock('virtual:bike-app/ride-redirects', () => ({
  default: {},
}));

const { onRequest } = await import('../src/middleware');

// Helper to build a minimal Astro middleware context
function makeContext(pathname: string, opts: { cookie?: string } = {}) {
  const deletedCookies: string[] = [];

  const context = {
    url: new URL(`http://localhost${pathname}`),
    cookies: {
      get: (name: string) => opts.cookie && name === 'session_token' ? { value: opts.cookie } : undefined,
      delete: (name: string) => { deletedCookies.push(name); },
      set: vi.fn(),
    },
    redirect: (url: string) => {
      return new Response(null, { status: 302, headers: { Location: url } });
    },
    locals: {} as Record<string, any>,
  };

  return { context, deletedCookies };
}

describe('onRequest middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function htmlResponse() {
    return new Response('<html></html>', {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  it('passes through for public routes', async () => {
    const { context } = makeContext('/routes/my-route');
    const next = vi.fn(async () => new Response('OK'));
    await onRequest(context as any, next);
    expect(next).toHaveBeenCalled();
  });

  it('adds nonce-based CSP header for auth pages', async () => {
    const { context } = makeContext('/login');
    const next = vi.fn(async () => htmlResponse());
    const res = await onRequest(context as any, next) as Response;

    expect(res.headers.get('Content-Security-Policy')).toContain("script-src 'self'");
    expect(context.locals.cspNonce).toMatch(/^[a-f0-9]{32}$/);
    expect(res.headers.get('Content-Security-Policy'))
      .toContain(`'nonce-${context.locals.cspNonce}'`);
  });

  it('adds nonce attributes to inline scripts on nonce-CSP pages', async () => {
    const { context } = makeContext('/gate');
    const next = vi.fn(async () => new Response(
      '<html><script>window.a=1</script><script nonce="keep">window.b=2</script></html>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    ));
    const res = await onRequest(context as any, next) as Response;
    const body = await res.text();

    expect(context.locals.cspNonce).toMatch(/^[a-f0-9]{32}$/);
    expect(body).toContain(`<script nonce="${context.locals.cspNonce}">window.a=1</script>`);
    expect(body).toContain('<script nonce="keep">window.b=2</script>');
  });

  it('adds nonce-based CSP header for authenticated admin HTML pages', async () => {
    const user = { id: 'u1', username: 'test', role: 'editor', bannedAt: null };
    mockValidateSession.mockResolvedValue(user);
    const { context } = makeContext('/admin/settings', { cookie: 'valid-token' });
    const next = vi.fn(async () => htmlResponse());
    const res = await onRequest(context as any, next) as Response;

    expect(context.locals.user).toEqual(user);
    expect(context.locals.cspNonce).toMatch(/^[a-f0-9]{32}$/);
    expect(res.headers.get('Content-Security-Policy'))
      .toContain(`'nonce-${context.locals.cspNonce}'`);
  });

  it('does not add nonce CSP header for public static pages', async () => {
    const { context } = makeContext('/routes/aylmer');
    const next = vi.fn(async () => htmlResponse());
    const res = await onRequest(context as any, next) as Response;

    expect(context.locals.cspNonce).toBeUndefined();
    expect(res.headers.get('Content-Security-Policy')).toBeNull();
  });

  it('redirects to /gate for non-browsable admin pages with no cookie', async () => {
    const { context } = makeContext('/admin/settings');
    const next = vi.fn();
    const res = await onRequest(context as any, next) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain('/gate');
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for API routes with no cookie', async () => {
    const { context } = makeContext('/api/routes/test');
    const next = vi.fn();
    const res = await onRequest(context as any, next) as Response;
    expect(res.status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('banned user on API route → 403', async () => {
    mockValidateSession.mockResolvedValue({
      id: 'u1', username: 'banned', role: 'editor', bannedAt: '2026-01-01',
    });
    const { context } = makeContext('/api/routes/test', { cookie: 'valid-token' });
    const next = vi.fn();
    const res = await onRequest(context as any, next) as Response;
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Forbidden');
    expect(next).not.toHaveBeenCalled();
  });

  it('banned user on admin page → redirect to /gate', async () => {
    mockValidateSession.mockResolvedValue({
      id: 'u1', username: 'banned', role: 'editor', bannedAt: '2026-01-01',
    });
    const { context } = makeContext('/admin/settings', { cookie: 'valid-token' });
    const next = vi.fn();
    const res = await onRequest(context as any, next) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/gate');
    expect(next).not.toHaveBeenCalled();
  });

  it('valid session sets user on locals and calls next', async () => {
    const user = { id: 'u1', username: 'test', role: 'editor', bannedAt: null };
    mockValidateSession.mockResolvedValue(user);
    const { context } = makeContext('/admin/settings', { cookie: 'valid-token' });
    const next = vi.fn(async () => new Response('OK'));
    await onRequest(context as any, next);
    expect(next).toHaveBeenCalled();
    expect(context.locals.user).toEqual(user);
  });

  it('invalid token clears cookies and redirects', async () => {
    mockValidateSession.mockResolvedValue(null);
    const { context, deletedCookies } = makeContext('/admin/settings', { cookie: 'bad-token' });
    const next = vi.fn();
    const res = await onRequest(context as any, next) as Response;
    expect(res.status).toBe(302);
    expect(deletedCookies).toContain('session_token');
    expect(deletedCookies).toContain('logged_in');
  });
});

describe('browsable admin paths', () => {
  function htmlResponse() {
    return new Response('<html></html>', {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  it('allows unauthenticated access to /admin (dashboard)', async () => {
    const { context } = makeContext('/admin');
    const next = vi.fn(async () => htmlResponse());
    await onRequest(context as any, next);
    expect(next).toHaveBeenCalled();
    expect(context.locals.user).toBeDefined();
    expect(context.locals.user.id).toBe('');
    expect(context.locals.user.role).toBe('guest');
  });

  it('allows unauthenticated access to /admin/routes', async () => {
    const { context } = makeContext('/admin/routes');
    const next = vi.fn(async () => htmlResponse());
    await onRequest(context as any, next);
    expect(next).toHaveBeenCalled();
    expect(context.locals.user.id).toBe('');
  });

  it('strips trailing slash when matching browsable paths', async () => {
    const { context } = makeContext('/admin/routes/');
    const next = vi.fn(async () => htmlResponse());
    await onRequest(context as any, next);
    expect(next).toHaveBeenCalled();
    expect(context.locals.user.id).toBe('');
  });

  it('still redirects /admin/routes/new to gate', async () => {
    const { context } = makeContext('/admin/routes/new');
    const next = vi.fn();
    const res = await onRequest(context as any, next) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain('/gate');
    expect(next).not.toHaveBeenCalled();
  });

  it('allows anonymous browsing of /admin/history', async () => {
    const { context } = makeContext('/admin/history');
    const next = vi.fn(async () => htmlResponse());
    await onRequest(context as any, next);
    expect(next).toHaveBeenCalled();
    expect(context.locals.user).toEqual(expect.objectContaining({ id: '', role: 'guest' }));
  });

  it('allows anonymous browsing of /api/admin/history', async () => {
    const { context } = makeContext('/api/admin/history');
    const next = vi.fn(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
    await onRequest(context as any, next);
    expect(next).toHaveBeenCalled();
    expect(context.locals.user).toEqual(expect.objectContaining({ id: '', role: 'guest' }));
  });

  it('populates real user on browsable path when valid session exists', async () => {
    const user = { id: 'u1', username: 'test', role: 'editor', bannedAt: null };
    mockValidateSession.mockResolvedValue(user);
    const { context } = makeContext('/admin/routes', { cookie: 'valid-token' });
    const next = vi.fn(async () => htmlResponse());
    await onRequest(context as any, next);
    expect(context.locals.user).toEqual(user);
  });

  it('falls back to anonymous on browsable path when session is invalid', async () => {
    mockValidateSession.mockResolvedValue(null);
    const { context, deletedCookies } = makeContext('/admin/routes', { cookie: 'bad-token' });
    const next = vi.fn(async () => htmlResponse());
    await onRequest(context as any, next);
    expect(next).toHaveBeenCalled();
    expect(context.locals.user.id).toBe('');
    expect(deletedCookies).toContain('session_token');
  });

  it('falls back to anonymous and clears cookies for banned user on browsable path', async () => {
    mockValidateSession.mockResolvedValue({
      id: 'u1', username: 'banned', role: 'editor', bannedAt: '2026-01-01',
    });
    const { context, deletedCookies } = makeContext('/admin/routes', { cookie: 'valid-token' });
    const next = vi.fn(async () => htmlResponse());
    await onRequest(context as any, next);
    expect(next).toHaveBeenCalled();
    expect(context.locals.user.id).toBe('');
    expect(deletedCookies).toContain('session_token');
    expect(deletedCookies).toContain('logged_in');
  });
});
