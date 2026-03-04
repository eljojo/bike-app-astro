import { describe, it, expect } from 'vitest';
import { parseRwgpsUrl } from '../src/views/api/gpx/import-rwgps';

describe('parseRwgpsUrl', () => {
  it('extracts route ID from standard URL', () => {
    expect(parseRwgpsUrl('https://ridewithgps.com/routes/12345')).toBe('12345');
  });

  it('extracts route ID from URL with trailing slash', () => {
    expect(parseRwgpsUrl('https://ridewithgps.com/routes/12345/')).toBe('12345');
  });

  it('extracts route ID from URL with query params', () => {
    expect(parseRwgpsUrl('https://ridewithgps.com/routes/12345?privacy=1')).toBe('12345');
  });

  it('returns null for non-RWGPS URL', () => {
    expect(parseRwgpsUrl('https://strava.com/routes/123')).toBeNull();
  });

  it('returns null for RWGPS non-route URL', () => {
    expect(parseRwgpsUrl('https://ridewithgps.com/users/123')).toBeNull();
  });
});
