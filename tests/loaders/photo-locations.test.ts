import { describe, it, expect } from 'vitest';
import { buildPhotoLocations } from '../../src/loaders/photo-locations';

describe('buildPhotoLocations', () => {
  it('extracts geolocated photos from route data', () => {
    const routes = {
      'canal': {
        media: [
          { type: 'photo', key: 'abc', lat: 45.42, lng: -75.69, caption: 'Canal' },
          { type: 'photo', key: 'def' }, // no coords — excluded
          { type: 'video', key: 'vid1', lat: 45.0, lng: -75.0 }, // video — excluded
        ],
      },
      'river': {
        media: [
          { type: 'photo', key: 'xyz', lat: 45.5, lng: -75.7, width: 1600, height: 1200 },
        ],
      },
    };
    const result = buildPhotoLocations(routes as any);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      key: 'abc', lat: 45.42, lng: -75.69, routeSlug: 'canal',
      caption: 'Canal', width: undefined, height: undefined,
    });
    expect(result[1]).toEqual({
      key: 'xyz', lat: 45.5, lng: -75.7, routeSlug: 'river',
      caption: undefined, width: 1600, height: 1200,
    });
  });

  it('returns empty array when no photos have coordinates', () => {
    const routes = { 'test': { media: [{ type: 'photo', key: 'a' }] } };
    const result = buildPhotoLocations(routes as any);
    expect(result).toEqual([]);
  });
});
