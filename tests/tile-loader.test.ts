import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTileLoader } from '../src/lib/maps/tile-loader';
import type { TileManifestEntry } from '../src/lib/maps/tile-loader';
import type { Feature, FeatureCollection } from 'geojson';

function makeManifestEntry(overrides: Partial<TileManifestEntry> & { id: string }): TileManifestEntry {
  return {
    bounds: [-76, 45, -75, 46],
    featureCount: 1,
    file: `tile-${overrides.id}.geojson`,
    ...overrides,
  };
}

function makeFeature(fid: string): Feature {
  return {
    type: 'Feature',
    properties: { _fid: fid, name: `feature-${fid}` },
    geometry: { type: 'LineString', coordinates: [[-75.5, 45.5], [-75.4, 45.4]] },
  };
}

function makeFeatureCollection(...features: Feature[]): FeatureCollection {
  return { type: 'FeatureCollection', features };
}

function mockFetchSuccess(fc: FeatureCollection): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(fc),
  });
}

describe('createTileLoader', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches tiles intersecting viewport bounds', async () => {
    const manifest = [
      makeManifestEntry({ id: 'a', bounds: [-76, 45, -75, 46] }),
      makeManifestEntry({ id: 'b', bounds: [-74, 44, -73, 45] }), // outside viewport
    ];
    const fc = makeFeatureCollection(makeFeature('a:0'));
    const fetch = mockFetchSuccess(fc);
    vi.stubGlobal('fetch', fetch);

    const loader = createTileLoader(manifest, '/tiles/');
    const features = await loader.loadTilesForBounds([-76, 45, -75, 46]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/tiles/tile-a.geojson');
    expect(features).toHaveLength(1);
    expect(features[0].properties?._fid).toBe('a:0');
  });

  it('does not re-fetch cached tiles', async () => {
    const manifest = [makeManifestEntry({ id: 'a', bounds: [-76, 45, -75, 46] })];
    const fc = makeFeatureCollection(makeFeature('a:0'));
    const fetch = mockFetchSuccess(fc);
    vi.stubGlobal('fetch', fetch);

    const loader = createTileLoader(manifest, '/tiles/');
    await loader.loadTilesForBounds([-76, 45, -75, 46]);
    await loader.loadTilesForBounds([-76, 45, -75, 46]);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('deduplicates features by _fid', async () => {
    const manifest = [
      makeManifestEntry({ id: 'a', bounds: [-76, 45, -75, 46] }),
      makeManifestEntry({ id: 'b', bounds: [-75.5, 45.5, -74.5, 46.5] }),
    ];
    // Same _fid appears in both tiles (cross-boundary feature)
    const sharedFeature = makeFeature('shared:0');
    const uniqueFeature = makeFeature('unique:0');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeFeatureCollection(sharedFeature)),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeFeatureCollection(sharedFeature, uniqueFeature)),
      });
    vi.stubGlobal('fetch', fetchMock);

    const loader = createTileLoader(manifest, '/tiles/');
    // Viewport covers both tiles
    const features = await loader.loadTilesForBounds([-76, 45, -74, 47]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(features).toHaveLength(2);
    const fids = features.map(f => f.properties?._fid);
    expect(fids).toContain('shared:0');
    expect(fids).toContain('unique:0');
  });

  it('deduplicates in-flight requests', async () => {
    const manifest = [makeManifestEntry({ id: 'a', bounds: [-76, 45, -75, 46] })];
    const fc = makeFeatureCollection(makeFeature('a:0'));
    const fetchMock = mockFetchSuccess(fc);
    vi.stubGlobal('fetch', fetchMock);

    const loader = createTileLoader(manifest, '/tiles/');
    // Fire two concurrent requests for the same bounds
    const [result1, result2] = await Promise.all([
      loader.loadTilesForBounds([-76, 45, -75, 46]),
      loader.loadTilesForBounds([-76, 45, -75, 46]),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result1).toHaveLength(1);
    expect(result2).toHaveLength(1);
  });

  it('skips tiles that fail to fetch', async () => {
    const manifest = [
      makeManifestEntry({ id: 'good', bounds: [-76, 45, -75, 46] }),
      makeManifestEntry({ id: 'bad', bounds: [-75.5, 45.5, -74.5, 46.5] }),
    ];
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('bad')) {
        return Promise.resolve({ ok: false, status: 404 });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(makeFeatureCollection(makeFeature('good:0'))),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const loader = createTileLoader(manifest, '/tiles/');
    const features = await loader.loadTilesForBounds([-76, 45, -74, 47]);

    expect(features).toHaveLength(1);
    expect(features[0].properties?._fid).toBe('good:0');
  });

  it('allLoadedFeatures returns cumulative features', async () => {
    const manifest = [
      makeManifestEntry({ id: 'a', bounds: [-76, 45, -75, 46] }),
      makeManifestEntry({ id: 'b', bounds: [-74, 44, -73, 45] }),
    ];
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('tile-a')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(makeFeatureCollection(makeFeature('a:0'))),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(makeFeatureCollection(makeFeature('b:0'), makeFeature('b:1'))),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const loader = createTileLoader(manifest, '/tiles/');

    await loader.loadTilesForBounds([-76, 45, -75, 46]);
    expect(loader.allLoadedFeatures()).toHaveLength(1);

    await loader.loadTilesForBounds([-74, 44, -73, 45]);
    expect(loader.allLoadedFeatures()).toHaveLength(3);
  });
});
