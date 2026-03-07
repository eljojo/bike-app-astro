import { describe, it, expect } from 'vitest';
import { buildPhotoLocations, buildNearbyPhotosMap } from '../../src/loaders/photo-locations';

describe('buildPhotoLocations', () => {
  it('extracts geolocated photos from route data', () => {
    // Admin detail media is already filtered to photos only (no type field)
    const routes = {
      'canal': {
        media: [
          { key: 'abc', lat: 45.42, lng: -75.69, caption: 'Canal' },
          { key: 'def' }, // no coords — excluded
        ],
      },
      'river': {
        media: [
          { key: 'xyz', lat: 45.5, lng: -75.7, width: 1600, height: 1200 },
        ],
      },
    };
    const result = buildPhotoLocations(routes);
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
    const routes = { 'test': { media: [{ key: 'a' }] } };
    const result = buildPhotoLocations(routes);
    expect(result).toEqual([]);
  });
});

describe('buildNearbyPhotosMap', () => {
  it('maps route slugs to nearby photos from other routes', () => {
    const allPhotos = [
      { key: 'p1', lat: 45.4216, lng: -75.6970, routeSlug: 'canal', width: 100, height: 100 },
      { key: 'p2', lat: 45.4220, lng: -75.6950, routeSlug: 'river', width: 100, height: 100 },
      { key: 'p3', lat: 45.5000, lng: -75.5000, routeSlug: 'far-route', width: 100, height: 100 },
    ];
    // Canal route's track passes near p2 (river's photo)
    const routeTracks = {
      'canal': [
        { lat: 45.4215, lng: -75.6972 },
        { lat: 45.4220, lng: -75.6950 },
        { lat: 45.4225, lng: -75.6930 },
      ],
    };
    const result = buildNearbyPhotosMap(allPhotos, routeTracks);
    expect(result['canal']).toBeDefined();
    expect(result['canal'].map(p => p.key)).toContain('p2');
    expect(result['canal'].map(p => p.key)).not.toContain('p1'); // own route excluded
    expect(result['canal'].map(p => p.key)).not.toContain('p3'); // too far
  });

  it('returns empty map when no nearby photos exist', () => {
    const allPhotos = [
      { key: 'p1', lat: 0, lng: 0, routeSlug: 'other', width: 100, height: 100 },
    ];
    const routeTracks = {
      'canal': [{ lat: 45.4215, lng: -75.6972 }],
    };
    const result = buildNearbyPhotosMap(allPhotos, routeTracks);
    expect(result['canal']).toBeUndefined();
  });
});
