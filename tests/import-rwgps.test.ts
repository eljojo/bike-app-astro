import { describe, it, expect } from 'vitest';
import { parseRwgpsUrl } from '../src/views/api/gpx/import-rwgps';

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

  it('returns null for non-RWGPS URL', () => {
    expect(parseRwgpsUrl('https://strava.com/routes/123')).toBeNull();
  });

  it('returns null for RWGPS non-route URL', () => {
    expect(parseRwgpsUrl('https://ridewithgps.com/users/123')).toBeNull();
  });
});
