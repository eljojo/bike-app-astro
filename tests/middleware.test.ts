import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Astro runtime module
vi.mock('astro:middleware', () => ({
  defineMiddleware: (fn: any) => fn,
}));

// Mock dependencies before importing middleware
const mockValidateSession = vi.fn();
vi.mock('../src/lib/auth', () => ({
  validateSession: (...args: any[]) => mockValidateSession(...args),
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

// Path matching tests (preserved from original)
describe('middleware path matching', () => {
  function isProtectedRoute(pathname: string): boolean {
    return (
      pathname.startsWith('/admin') ||
      (pathname.startsWith('/api/') && !pathname.startsWith('/api/auth/'))
    );
  }

  it('protects /admin', () => {
    expect(isProtectedRoute('/admin')).toBe(true);
    expect(isProtectedRoute('/admin/')).toBe(true);
    expect(isProtectedRoute('/admin/routes/my-route')).toBe(true);
  });

  it('protects non-auth API routes', () => {
    expect(isProtectedRoute('/api/routes/my-route')).toBe(true);
    expect(isProtectedRoute('/api/media/presign')).toBe(true);
    expect(isProtectedRoute('/api/admin/invite')).toBe(true);
  });

  it('does not protect auth API routes', () => {
    expect(isProtectedRoute('/api/auth/login')).toBe(false);
    expect(isProtectedRoute('/api/auth/login-options')).toBe(false);
    expect(isProtectedRoute('/api/auth/register')).toBe(false);
    expect(isProtectedRoute('/api/auth/register-options')).toBe(false);
    expect(isProtectedRoute('/api/auth/logout')).toBe(false);
  });

  it('does not protect public pages', () => {
    expect(isProtectedRoute('/')).toBe(false);
    expect(isProtectedRoute('/routes')).toBe(false);
    expect(isProtectedRoute('/routes/my-route')).toBe(false);
    expect(isProtectedRoute('/login')).toBe(false);
    expect(isProtectedRoute('/register')).toBe(false);
    expect(isProtectedRoute('/setup')).toBe(false);
    expect(isProtectedRoute('/map')).toBe(false);
    expect(isProtectedRoute('/guides')).toBe(false);
    expect(isProtectedRoute('/calendar')).toBe(false);
  });
});

// onRequest handler tests
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
    expect(context.locals.cspNonce).toBeTypeOf('string');
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

    expect(context.locals.cspNonce).toBeTypeOf('string');
    expect(body).toContain(`<script nonce="${context.locals.cspNonce}">window.a=1</script>`);
    expect(body).toContain('<script nonce="keep">window.b=2</script>');
  });

  it('adds nonce-based CSP header for authenticated admin HTML pages', async () => {
    const user = { id: 'u1', username: 'test', role: 'editor', bannedAt: null };
    mockValidateSession.mockResolvedValue(user);
    const { context } = makeContext('/admin/routes', { cookie: 'valid-token' });
    const next = vi.fn(async () => htmlResponse());
    const res = await onRequest(context as any, next) as Response;

    expect(context.locals.user).toEqual(user);
    expect(context.locals.cspNonce).toBeTypeOf('string');
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

  it('redirects to /gate for admin pages with no cookie', async () => {
    const { context } = makeContext('/admin/routes');
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
    const { context } = makeContext('/admin/routes', { cookie: 'valid-token' });
    const next = vi.fn();
    const res = await onRequest(context as any, next) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/gate');
    expect(next).not.toHaveBeenCalled();
  });

  it('valid session sets user on locals and calls next', async () => {
    const user = { id: 'u1', username: 'test', role: 'editor', bannedAt: null };
    mockValidateSession.mockResolvedValue(user);
    const { context } = makeContext('/admin/routes', { cookie: 'valid-token' });
    const next = vi.fn(async () => new Response('OK'));
    await onRequest(context as any, next);
    expect(next).toHaveBeenCalled();
    expect(context.locals.user).toEqual(user);
  });

  it('invalid token clears cookies and redirects', async () => {
    mockValidateSession.mockResolvedValue(null);
    const { context, deletedCookies } = makeContext('/admin/routes', { cookie: 'bad-token' });
    const next = vi.fn();
    const res = await onRequest(context as any, next) as Response;
    expect(res.status).toBe(302);
    expect(deletedCookies).toContain('session_token');
    expect(deletedCookies).toContain('logged_in');
  });
});
