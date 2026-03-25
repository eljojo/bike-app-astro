import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Astro runtime module
vi.mock('astro:middleware', () => ({
  defineMiddleware: (fn: any) => fn,
}));

// Mock content redirects virtual module
vi.mock('virtual:bike-app/content-redirects', () => ({
  default: {
    '/guides/local-communities': '/communities',
    '/routes/old-name': '/routes/new-name',
    '/videos/48-whoop': '/videos/whoop',
    '/rides/riding-around-the-greenbelt': '/routes/greenbelt',
  },
}));

// Mock ride redirects (empty — tested separately)
vi.mock('virtual:bike-app/ride-redirects', () => ({
  default: {
    '/rides/420-evening-ride': '/rides/2014-06-23-evening-ride',
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

describe('content redirects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects short_urls entry', async () => {
    const context = makeContext('/guides/local-communities');
    const next = vi.fn();
    const res = await onRequest(context as any, next) as Response;

    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('/communities');
    expect(next).not.toHaveBeenCalled();
  });

  it('redirects with trailing slash stripped', async () => {
    const context = makeContext('/guides/local-communities/');
    const next = vi.fn();
    const res = await onRequest(context as any, next) as Response;

    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('/communities');
    expect(next).not.toHaveBeenCalled();
  });

  it('redirects per-route redirect entry', async () => {
    const context = makeContext('/rides/riding-around-the-greenbelt');
    const next = vi.fn();
    const res = await onRequest(context as any, next) as Response;

    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('/routes/greenbelt');
    expect(next).not.toHaveBeenCalled();
  });

  it('redirects per-route entry with trailing slash', async () => {
    const context = makeContext('/rides/riding-around-the-greenbelt/');
    const next = vi.fn();
    const res = await onRequest(context as any, next) as Response;

    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('/routes/greenbelt');
    expect(next).not.toHaveBeenCalled();
  });

  it('redirects /map sub-path to target /map', async () => {
    const context = makeContext('/rides/riding-around-the-greenbelt/map');
    const next = vi.fn();
    const res = await onRequest(context as any, next) as Response;

    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('/routes/greenbelt/map');
    expect(next).not.toHaveBeenCalled();
  });

  it('redirects video slug redirect', async () => {
    const context = makeContext('/videos/48-whoop');
    const next = vi.fn();
    const res = await onRequest(context as any, next) as Response;

    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('/videos/whoop');
    expect(next).not.toHaveBeenCalled();
  });

  it('ride redirects still take priority', async () => {
    const context = makeContext('/rides/420-evening-ride');
    const next = vi.fn();
    const res = await onRequest(context as any, next) as Response;

    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('/rides/2014-06-23-evening-ride');
    expect(next).not.toHaveBeenCalled();
  });

  it('ride redirects work with trailing slash', async () => {
    const context = makeContext('/rides/420-evening-ride/');
    const next = vi.fn();
    const res = await onRequest(context as any, next) as Response;

    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('/rides/2014-06-23-evening-ride');
    expect(next).not.toHaveBeenCalled();
  });

  it('does not redirect unknown paths', async () => {
    const context = makeContext('/routes/some-real-route');
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

describe('locale segment redirects', () => {
  it('redirects /fr/routes/* to /fr/parcours/*', async () => {
    const context = makeContext('/fr/routes/richmond-manotick');
    const next = vi.fn();
    const res = await onRequest(context as any, next) as Response;

    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('/fr/parcours/richmond-manotick');
    expect(next).not.toHaveBeenCalled();
  });

  it('redirects /fr/calendar to /fr/calendrier', async () => {
    const context = makeContext('/fr/calendar');
    const next = vi.fn();
    const res = await onRequest(context as any, next) as Response;

    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('/fr/calendrier');
    expect(next).not.toHaveBeenCalled();
  });

  it('redirects /fr/routes/slug/map to /fr/parcours/slug/carte', async () => {
    const context = makeContext('/fr/routes/richmond-manotick/map');
    const next = vi.fn();
    const res = await onRequest(context as any, next) as Response;

    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('/fr/parcours/richmond-manotick/carte');
    expect(next).not.toHaveBeenCalled();
  });

  it('does not redirect already-translated French paths', async () => {
    const context = makeContext('/fr/parcours/richmond-manotick');
    const next = vi.fn(async () => new Response('OK'));
    await onRequest(context as any, next);

    expect(next).toHaveBeenCalled();
  });

  it('does not redirect default locale paths', async () => {
    const context = makeContext('/en/routes/richmond-manotick');
    const next = vi.fn(async () => new Response('OK'));
    await onRequest(context as any, next);

    expect(next).toHaveBeenCalled();
  });

  it('does not redirect paths without locale prefix', async () => {
    const context = makeContext('/routes/richmond-manotick');
    const next = vi.fn(async () => new Response('OK'));
    await onRequest(context as any, next);

    expect(next).toHaveBeenCalled();
  });
});
