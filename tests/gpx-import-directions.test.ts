import { describe, it, expect, vi, beforeEach } from 'vitest';

const testUser = { id: 1, username: 'test', role: 'admin' };

vi.mock('../src/lib/auth/authorize', () => ({
  authorize: () => testUser,
}));

vi.mock('../src/lib/auth/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  recordAttempt: vi.fn(),
  cleanupOldAttempts: vi.fn(() => Promise.resolve()),
}));

vi.mock('../src/lib/get-db', () => ({ db: () => ({}) }));
vi.mock('../src/lib/env/env.service', () => ({ env: {} }));

vi.mock('../src/lib/external/routing.server', () => ({
  createRoutingService: vi.fn(),
}));

vi.mock('../src/lib/geo/elevation-enrichment', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/lib/geo/elevation-enrichment')>();
  return {
    ...original,
    enrichWithElevation: vi.fn((points) => Promise.resolve(points)),
  };
});

vi.mock('../src/lib/external/url-resolve.server', () => ({
  resolveUrl: vi.fn(),
}));

import { detectUrlSource } from '../src/views/api/gpx/import';
import { createRoutingService } from '../src/lib/external/routing.server';
import { enrichWithElevation } from '../src/lib/geo/elevation-enrichment';

describe('detectUrlSource — google-directions', () => {
  it('returns google-directions for a directions URL', () => {
    expect(
      detectUrlSource(
        'https://www.google.com/maps/dir/Royal+Oak,+Ottawa,+ON/Whiprsnapr+Brewing,+Ottawa,+ON/data=!4m2!4m1!3e1',
      ),
    ).toBe('google-directions');
  });

  it('still returns rwgps for RWGPS URLs', () => {
    expect(detectUrlSource('https://ridewithgps.com/routes/12345')).toBe('rwgps');
  });

  it('still returns google-maps for My Maps URLs', () => {
    expect(
      detectUrlSource('https://www.google.com/maps/d/edit?mid=1ABC123&usp=sharing'),
    ).toBe('google-maps');
  });

  it('returns null for shortened URLs (resolution happens in POST handler)', () => {
    expect(detectUrlSource('https://maps.app.goo.gl/abc123')).toBeNull();
  });
});

describe('handleGoogleDirections — full handler flow', () => {
  const mockRoutingService = {
    getRoute: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createRoutingService).mockReturnValue(mockRoutingService);
    vi.mocked(enrichWithElevation).mockImplementation((points) => Promise.resolve(points));
  });

  async function callImport(url: string): Promise<Response> {
    const { POST } = await import('../src/views/api/gpx/import');
    const request = new Request('http://localhost/api/gpx/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const locals = {
      session: { userId: '1', username: 'test', role: 'admin' },
    };
    return POST({ request, locals } as any);
  }

  it('parses waypoints, routes, enriches, and returns GPX with correct name and sourceUrl', async () => {
    const directionsUrl =
      'https://www.google.com/maps/dir/Royal+Oak,+Ottawa,+ON/Whiprsnapr+Brewing,+Ottawa,+ON/data=!3m1!4b1!4m14!4m13!1m5!1m1!1s0x4cce04ff98415e73:0x1234!2m2!1d-75.7!2d45.4!1m5!1m1!1s0x4cce04ff98415e74:0x5678!2m2!1d-75.8!2d45.5!3e1';

    mockRoutingService.getRoute.mockResolvedValue({
      points: [
        { lat: 45.4, lon: -75.7 },
        { lat: 45.45, lon: -75.75 },
        { lat: 45.5, lon: -75.8 },
      ],
      distance_m: 12000,
    });

    const response = await callImport(directionsUrl);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.gpxContent).toContain('<name>Royal Oak to Whiprsnapr Brewing</name>');
    expect(data.sourceUrl).toBe(directionsUrl);
    expect(data.name).toBe('Royal Oak to Whiprsnapr Brewing');

    expect(mockRoutingService.getRoute).toHaveBeenCalledOnce();
    expect(vi.mocked(enrichWithElevation)).toHaveBeenCalledOnce();
  });

  it('derives route name from first and last named stops using normalizeStopName', async () => {
    const directionsUrl =
      'https://www.google.com/maps/dir/Royal+Oak,+123+Laurier+Ave,+Ottawa,+ON/45.42,-75.69/Whiprsnapr+Brewing,+456+Bank+St,+Ottawa,+ON/data=!3m1!4b1!4m14!4m13!1m5!1m1!1s0x1:0x2!2m2!1d-75.7!2d45.4!1m0!1m5!1m1!1s0x3:0x4!2m2!1d-75.8!2d45.5!3e1';

    mockRoutingService.getRoute.mockResolvedValue({
      points: [
        { lat: 45.4, lon: -75.7 },
        { lat: 45.5, lon: -75.8 },
      ],
      distance_m: 8000,
    });

    const response = await callImport(directionsUrl);
    const data = await response.json();
    expect(data.name).toBe('Royal Oak to Whiprsnapr Brewing');
  });

  it('returns error when routing service fails', async () => {
    const directionsUrl =
      'https://www.google.com/maps/dir/Royal+Oak,+Ottawa,+ON/Whiprsnapr+Brewing,+Ottawa,+ON/data=!3m1!4b1!4m14!4m13!1m5!1m1!1s0x1:0x2!2m2!1d-75.7!2d45.4!1m5!1m1!1s0x3:0x4!2m2!1d-75.8!2d45.5!3e1';

    mockRoutingService.getRoute.mockRejectedValue(
      new Error('GOOGLE_DIRECTIONS_API_KEY is not configured'),
    );

    const response = await callImport(directionsUrl);
    expect(response.status).toBe(502);
    const data = await response.json();
    expect(data.error).toContain('GOOGLE_DIRECTIONS_API_KEY');
  });
});
