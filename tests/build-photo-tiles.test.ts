import { describe, it, expect } from 'vitest';
import { buildPhotoTiles, type PhotoTileInput, type PhotoRouteInfo } from '../src/build-data-plugin';

function makePhoto(overrides: Partial<PhotoTileInput> = {}): PhotoTileInput {
  return {
    key: 'photo-abc',
    lat: 45.5,
    lng: -73.6,
    routeSlug: 'test-route',
    caption: 'A nice photo',
    width: 1200,
    height: 800,
    type: 'photo',
    ...overrides,
  };
}

function makeRouteInfo(entries: Array<[string, { name: string; url: string }]> = []): Map<string, PhotoRouteInfo> {
  return new Map(entries);
}

describe('buildPhotoTiles', () => {
  it('assigns a photo to the correct 1-degree tile', () => {
    const photos = [makePhoto({ lat: 45.5, lng: -73.6 })];
    const routeInfo = makeRouteInfo([['test-route', { name: 'Test Route', url: '/routes/test-route' }]]);
    const { tiles, manifest } = buildPhotoTiles(photos, routeInfo);

    expect(tiles.size).toBe(1);
    const tileId = '45_-74';
    const tile = tiles.get(tileId);
    expect(tile).toBeDefined();
    expect(tile!.features).toHaveLength(1);
    expect(tile!.features[0].properties?.key).toBe('photo-abc');

    expect(manifest).toHaveLength(1);
    expect(manifest[0].id).toBe(tileId);
    expect(manifest[0].featureCount).toBe(1);
    expect(manifest[0].file).toBe('tile-45_-74.geojson');
  });

  it('uses photo key as _fid for tile-loader dedup compatibility', () => {
    const photos = [makePhoto({ key: 'unique-key-123' })];
    const { tiles } = buildPhotoTiles(photos, makeRouteInfo());

    const feature = [...tiles.values()][0].features[0];
    expect(feature.properties?._fid).toBe('unique-key-123');
  });

  it('filters out videos', () => {
    const photos = [
      makePhoto({ key: 'photo-1', type: 'photo' }),
      makePhoto({ key: 'video-1', type: 'video' }),
      makePhoto({ key: 'photo-2', type: undefined }),
    ];
    const { tiles } = buildPhotoTiles(photos, makeRouteInfo());

    const allFeatures = [...tiles.values()].flatMap(t => t.features);
    expect(allFeatures).toHaveLength(2);
    const keys = allFeatures.map(f => f.properties?.key);
    expect(keys).toContain('photo-1');
    expect(keys).toContain('photo-2');
    expect(keys).not.toContain('video-1');
  });

  it('groups photos in different tiles', () => {
    const photos = [
      makePhoto({ key: 'p1', lat: 45.5, lng: -73.6 }),   // tile 45_-74
      makePhoto({ key: 'p2', lat: 46.3, lng: -73.2 }),   // tile 46_-74
      makePhoto({ key: 'p3', lat: 45.9, lng: -73.1 }),   // tile 45_-74
    ];
    const { tiles, manifest } = buildPhotoTiles(photos, makeRouteInfo());

    expect(tiles.size).toBe(2);
    expect(tiles.get('45_-74')!.features).toHaveLength(2);
    expect(tiles.get('46_-74')!.features).toHaveLength(1);
    expect(manifest).toHaveLength(2);
  });

  it('computes actual bounding box for tile', () => {
    const photos = [
      makePhoto({ key: 'p1', lat: 45.3, lng: -73.8 }),
      makePhoto({ key: 'p2', lat: 45.7, lng: -73.2 }),
      makePhoto({ key: 'p3', lat: 45.1, lng: -73.5 }),
    ];
    const { manifest } = buildPhotoTiles(photos, makeRouteInfo());

    expect(manifest).toHaveLength(1);
    const [minLng, minLat, maxLng, maxLat] = manifest[0].bounds;
    expect(minLng).toBe(-73.8);
    expect(minLat).toBe(45.1);
    expect(maxLng).toBe(-73.2);
    expect(maxLat).toBe(45.7);
  });

  it('sorts manifest alphabetically by tile ID', () => {
    const photos = [
      makePhoto({ key: 'p1', lat: 46.5, lng: -73.6 }),   // tile 46_-74
      makePhoto({ key: 'p2', lat: 45.5, lng: -73.6 }),   // tile 45_-74
      makePhoto({ key: 'p3', lat: 45.5, lng: -72.6 }),   // tile 45_-73
    ];
    const { manifest } = buildPhotoTiles(photos, makeRouteInfo());

    const ids = manifest.map(m => m.id);
    expect(ids).toEqual(['45_-73', '45_-74', '46_-74']);
  });

  it('enriches features with route name and URL', () => {
    const photos = [makePhoto({ routeSlug: 'my-route' })];
    const routeInfo = makeRouteInfo([['my-route', { name: 'My Great Route', url: '/routes/my-route' }]]);
    const { tiles } = buildPhotoTiles(photos, routeInfo);

    const feature = [...tiles.values()][0].features[0];
    expect(feature.properties?.routeName).toBe('My Great Route');
    expect(feature.properties?.routeUrl).toBe('/routes/my-route');
  });

  it('uses empty strings when route info is missing', () => {
    const photos = [makePhoto({ routeSlug: 'unknown-route' })];
    const routeInfo = makeRouteInfo(); // empty
    const { tiles } = buildPhotoTiles(photos, routeInfo);

    const feature = [...tiles.values()][0].features[0];
    expect(feature.properties?.routeName).toBe('');
    expect(feature.properties?.routeUrl).toBe('');
  });

  it('uses empty strings for __parked route slug', () => {
    const photos = [makePhoto({ routeSlug: '__parked' })];
    const routeInfo = makeRouteInfo([['__parked', { name: 'Parked', url: '/parked' }]]);
    const { tiles } = buildPhotoTiles(photos, routeInfo);

    const feature = [...tiles.values()][0].features[0];
    expect(feature.properties?.routeName).toBe('');
    expect(feature.properties?.routeUrl).toBe('');
  });

  it('includes caption, width, and height in feature properties', () => {
    const photos = [makePhoto({ caption: 'Beautiful bridge', width: 1600, height: 1200 })];
    const { tiles } = buildPhotoTiles(photos, makeRouteInfo());

    const feature = [...tiles.values()][0].features[0];
    expect(feature.properties?.caption).toBe('Beautiful bridge');
    expect(feature.properties?.width).toBe(1600);
    expect(feature.properties?.height).toBe(1200);
  });

  it('defaults missing caption to empty string and dimensions to 0', () => {
    const photos = [makePhoto({ caption: undefined, width: undefined, height: undefined })];
    const { tiles } = buildPhotoTiles(photos, makeRouteInfo());

    const feature = [...tiles.values()][0].features[0];
    expect(feature.properties?.caption).toBe('');
    expect(feature.properties?.width).toBe(0);
    expect(feature.properties?.height).toBe(0);
  });

  it('returns empty tiles and manifest for empty input', () => {
    const { tiles, manifest } = buildPhotoTiles([], makeRouteInfo());

    expect(tiles.size).toBe(0);
    expect(manifest).toHaveLength(0);
  });

  it('returns empty tiles and manifest when all media are videos', () => {
    const photos = [
      makePhoto({ key: 'v1', type: 'video' }),
      makePhoto({ key: 'v2', type: 'video' }),
    ];
    const { tiles, manifest } = buildPhotoTiles(photos, makeRouteInfo());

    expect(tiles.size).toBe(0);
    expect(manifest).toHaveLength(0);
  });

  it('creates Point geometry with [lng, lat] coordinates', () => {
    const photos = [makePhoto({ lat: 45.5, lng: -73.6 })];
    const { tiles } = buildPhotoTiles(photos, makeRouteInfo());

    const feature = [...tiles.values()][0].features[0];
    expect(feature.geometry).toEqual({
      type: 'Point',
      coordinates: [-73.6, 45.5],
    });
  });

  it('handles negative lat/lng tile assignment correctly', () => {
    // Math.floor(-36.619) = -37, Math.floor(-72.112) = -73
    const photos = [makePhoto({ key: 'southern', lat: -36.619, lng: -72.112 })];
    const { tiles } = buildPhotoTiles(photos, makeRouteInfo());

    expect(tiles.size).toBe(1);
    expect(tiles.has('-37_-73')).toBe(true);
  });
});
