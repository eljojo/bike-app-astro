import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Astro runtime module
vi.mock('astro:middleware', () => ({
  defineMiddleware: (fn: any) => fn,
}));

// Mock ride redirects virtual module
vi.mock('virtual:bike-app/ride-redirects', () => ({
  default: {
    '/rides/420-evening-ride': '/rides/2014-06-23-evening-ride',
    '/rides/420-evening-ride/map': '/rides/2014-06-23-evening-ride/map',
    '/rides/amsterdam': '/tours/euro-trip/amsterdam',
    '/rides/amsterdam/map': '/tours/euro-trip/amsterdam/map',
  },
}));

// Mock remaining dependencies
vi.mock('../src/lib/auth/auth', () => ({
  validateSession: vi.fn(),
}));
vi.mock('../src/lib/get-db', () => ({
  db: () => 'mock-db',
}));

const { onRequest } = await import('../src/middleware');

function makeContext(pathname: string) {
  return {
    url: new URL(`http://localhost${pathname}`),
    cookies: {
      get: () => undefined,
      delete: vi.fn(),
      set: vi.fn(),
    },
    redirect: (url: string, status?: number) => {
      return new Response(null, { status: status || 302, headers: { Location: url } });
    },
    locals: {} as Record<string, any>,
  };
}

describe('middleware ride redirects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects old ride slug to canonical slug', async () => {
    const context = makeContext('/rides/420-evening-ride');
    const next = vi.fn();
    const res = await onRequest(context as any, next) as Response;

    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('/rides/2014-06-23-evening-ride');
    expect(next).not.toHaveBeenCalled();
  });

  it('redirects old ride slug /map to canonical /map', async () => {
    const context = makeContext('/rides/420-evening-ride/map');
    const next = vi.fn();
    const res = await onRequest(context as any, next) as Response;

    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('/rides/2014-06-23-evening-ride/map');
    expect(next).not.toHaveBeenCalled();
  });

  it('redirects tour ride to nested tour path', async () => {
    const context = makeContext('/rides/amsterdam');
    const next = vi.fn();
    const res = await onRequest(context as any, next) as Response;

    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('/tours/euro-trip/amsterdam');
    expect(next).not.toHaveBeenCalled();
  });

  it('does not redirect unknown ride paths', async () => {
    const context = makeContext('/rides/some-new-ride');
    const next = vi.fn(async () => new Response('OK'));
    await onRequest(context as any, next);

    expect(next).toHaveBeenCalled();
  });

  it('does not redirect non-ride paths', async () => {
    const context = makeContext('/routes/canal-loop');
    const next = vi.fn(async () => new Response('OK'));
    await onRequest(context as any, next);

    expect(next).toHaveBeenCalled();
  });

  it('does not redirect the homepage', async () => {
    const context = makeContext('/');
    const next = vi.fn(async () => new Response('OK'));
    await onRequest(context as any, next);

    expect(next).toHaveBeenCalled();
  });
});
