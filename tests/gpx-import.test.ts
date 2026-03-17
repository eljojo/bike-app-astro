import { describe, it, expect, vi } from 'vitest';
import { parseRwgpsUrl, buildGpxFromTrackPoints } from '../src/views/api/gpx/import-rwgps';

vi.mock('../src/lib/get-db', () => ({ db: () => ({}) }));
vi.mock('../src/lib/env/env.service', () => ({ env: {} }));

import { detectUrlSource } from '../src/views/api/gpx/import';

describe('detectUrlSource', () => {
  it('detects RideWithGPS URL', () => {
    expect(detectUrlSource('https://ridewithgps.com/routes/12345')).toBe('rwgps');
  });

  it('detects Google My Maps edit URL', () => {
    expect(
      detectUrlSource('https://www.google.com/maps/d/edit?mid=1ABC123&usp=sharing'),
    ).toBe('google-maps');
  });

  it('detects Google My Maps viewer URL', () => {
    expect(
      detectUrlSource('https://www.google.com/maps/d/viewer?mid=1ABC123'),
    ).toBe('google-maps');
  });

  it('returns null for unsupported URL', () => {
    expect(detectUrlSource('https://strava.com/routes/123')).toBeNull();
  });

  it('returns null for regular Google Maps URL (not My Maps)', () => {
    expect(
      detectUrlSource('https://www.google.com/maps/@45.4,-75.7,12z'),
    ).toBeNull();
  });
});

describe('parseRwgpsUrl', () => {
  it('extracts route ID from standard URL', () => {
    expect(parseRwgpsUrl('https://ridewithgps.com/routes/12345')).toEqual({
      routeId: '12345',
      privacyCode: undefined,
    });
  });

  it('extracts route ID from URL with trailing slash', () => {
    const result = parseRwgpsUrl('https://ridewithgps.com/routes/12345/');
    expect(result?.routeId).toBe('12345');
  });

  it('extracts privacy code from URL', () => {
    expect(parseRwgpsUrl('https://ridewithgps.com/routes/41290515?privacy_code=QYzdfhB5D7M8D4qZ')).toEqual({
      routeId: '41290515',
      privacyCode: 'QYzdfhB5D7M8D4qZ',
    });
  });

  it('extracts privacy code from URL with trailing slash', () => {
    expect(parseRwgpsUrl('https://ridewithgps.com/routes/41290515/?privacy_code=QYzdfhB5D7M8D4qZ'))
      .toEqual({ routeId: '41290515', privacyCode: 'QYzdfhB5D7M8D4qZ' });
  });

  it('returns null for non-RWGPS URL', () => {
    expect(parseRwgpsUrl('https://strava.com/routes/123')).toBeNull();
  });

  it('returns null for RWGPS non-route URL', () => {
    expect(parseRwgpsUrl('https://ridewithgps.com/users/123')).toBeNull();
  });
});

describe('buildGpxFromTrackPoints', () => {
  it('builds valid GPX from track points', () => {
    const gpx = buildGpxFromTrackPoints('Test Route', [
      { x: -75.7, y: 45.4, e: 100 },
      { x: -75.8, y: 45.5, e: 110 },
    ]);
    expect(gpx).toContain('<?xml version="1.0"');
    expect(gpx).toContain('<name>Test Route</name>');
    expect(gpx).toContain('lat="45.4" lon="-75.7"');
    expect(gpx).toContain('<ele>100</ele>');
    expect(gpx).toContain('<trkseg>');
  });

  it('escapes XML special characters in name', () => {
    const gpx = buildGpxFromTrackPoints('A & B <route>', [{ x: 0, y: 0, e: 0 }]);
    expect(gpx).toContain('A &amp; B &lt;route&gt;');
  });
});
