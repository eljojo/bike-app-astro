import { describe, it, expect } from 'vitest';
import { findNearbyPhotos } from '../../src/lib/geo/photo-proximity';

describe('findNearbyPhotos', () => {
  const routePoints = [
    { lat: 45.4215, lng: -75.6972 }, // start
    { lat: 45.4220, lng: -75.6950 }, // mid
    { lat: 45.4225, lng: -75.6930 }, // end
  ];

  it('finds photos within 200m of route track', () => {
    const photos = [
      { key: 'near', lat: 45.4216, lng: -75.6970, routeSlug: 'other', width: 100, height: 100 },
      { key: 'far', lat: 45.5000, lng: -75.5000, routeSlug: 'other', width: 100, height: 100 },
    ];
    const result = findNearbyPhotos(routePoints, photos, 'current-route');
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('near');
  });

  it('excludes photos from the current route', () => {
    const photos = [
      { key: 'mine', lat: 45.4216, lng: -75.6970, routeSlug: 'current-route', width: 100, height: 100 },
    ];
    const result = findNearbyPhotos(routePoints, photos, 'current-route');
    expect(result).toHaveLength(0);
  });

  it('skips bounding box rejects without computing haversine', () => {
    const photos = [
      { key: 'far', lat: 0, lng: 0, routeSlug: 'other', width: 100, height: 100 },
    ];
    const result = findNearbyPhotos(routePoints, photos, 'current');
    expect(result).toHaveLength(0);
  });
});
