import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/env/env.service', () => ({
  env: { GOOGLE_PLACES_API_KEY: 'test-key-123' },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { createGoogleRoutingService } from '../../src/lib/external/routing.adapter-google.server';
import type { RoutingWaypoint } from '../../src/lib/external/routing';

const twoStops: RoutingWaypoint[] = [
  { lat: 45.343, lng: -75.762, type: 'stop', name: 'Royal Oak' },
  { lat: 45.330, lng: -75.819, type: 'stop', name: 'Whiprsnapr' },
];

describe('Google Directions routing adapter', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('assembles correct API parameters — origin, destination, middle waypoints', async () => {
    const fixture = (await import('../../e2e/fixtures/google-directions/fixture2-directions.json')).default;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(fixture),
    });

    const waypoints: RoutingWaypoint[] = [
      { lat: 45.343, lng: -75.762, type: 'stop', name: 'Royal Oak' },
      { lat: 45.326, lng: -75.805, type: 'via' },
      { lat: 45.327, lng: -75.793, type: 'shaping' },
      { lat: 45.330, lng: -75.819, type: 'stop', name: 'Whiprsnapr' },
    ];

    const service = createGoogleRoutingService();
    await service.getRoute(waypoints);

    expect(mockFetch).toHaveBeenCalledOnce();
    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get('origin')).toBe('45.343,-75.762');
    expect(url.searchParams.get('destination')).toBe('45.33,-75.819');
    expect(url.searchParams.get('mode')).toBe('bicycling');
    expect(url.searchParams.get('key')).toBe('test-key-123');

    // Middle waypoints: via and shaping get "via:" prefix, stops do not
    const wp = url.searchParams.get('waypoints');
    expect(wp).toContain('via:45.326,-75.805');
    expect(wp).toContain('via:45.327,-75.793');
  });

  it('decodes step-level polylines and converts lng to lon', async () => {
    const fixture = (await import('../../e2e/fixtures/google-directions/fixture2-directions.json')).default;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(fixture),
    });

    const service = createGoogleRoutingService();
    const result = await service.getRoute(twoStops);

    expect(result.distance_m).toBeGreaterThan(0);
    expect(result.points.length).toBeGreaterThan(0);

    // Every point must have lat and lon (not lng)
    for (const pt of result.points) {
      expect(pt).toHaveProperty('lat');
      expect(pt).toHaveProperty('lon');
      expect(pt).not.toHaveProperty('lng');
      expect(typeof pt.lat).toBe('number');
      expect(typeof pt.lon).toBe('number');
    }
  });

  it('sends name-only waypoints when lat is NaN', async () => {
    const fixture = (await import('../../e2e/fixtures/google-directions/fixture2-directions.json')).default;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(fixture),
    });

    const waypoints: RoutingWaypoint[] = [
      { lat: NaN, lng: NaN, type: 'stop', name: 'Some Place' },
      { lat: 45.330, lng: -75.819, type: 'stop', name: 'Whiprsnapr' },
    ];

    const service = createGoogleRoutingService();
    await service.getRoute(waypoints);

    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get('origin')).toBe('Some Place');
  });

  it('throws when API key is missing', async () => {
    vi.doMock('../../src/lib/env/env.service', () => ({
      env: { GOOGLE_PLACES_API_KEY: '' },
    }));

    const { createGoogleRoutingService: factory } = await import(
      '../../src/lib/external/routing.adapter-google.server'
    );

    const service = factory();
    await expect(service.getRoute(twoStops)).rejects.toThrow(/API key/i);

    // Restore the original mock
    vi.doMock('../../src/lib/env/env.service', () => ({
      env: { GOOGLE_PLACES_API_KEY: 'test-key-123' },
    }));
  });

  it('throws on API error status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: 'REQUEST_DENIED', routes: [] }),
    });

    const service = createGoogleRoutingService();
    await expect(service.getRoute(twoStops)).rejects.toThrow(/REQUEST_DENIED/);
  });

  it('throws on zero results', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: 'ZERO_RESULTS', routes: [] }),
    });

    const service = createGoogleRoutingService();
    await expect(service.getRoute(twoStops)).rejects.toThrow(/no route/i);
  });
});
