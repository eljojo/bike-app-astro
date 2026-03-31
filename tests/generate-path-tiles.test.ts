import { describe, it, expect } from 'vitest';
import { buildTiles } from '../scripts/generate-path-tiles';
import type { FeatureCollection, Feature, LineString, MultiLineString } from 'geojson';

function makeFeatureCollection(...features: Feature[]): FeatureCollection {
  return { type: 'FeatureCollection', features };
}

function makeLine(coordinates: [number, number][], properties: Record<string, unknown> = {}): Feature<LineString> {
  return {
    type: 'Feature',
    properties,
    geometry: { type: 'LineString', coordinates },
  };
}

function makeMultiLine(coordArrays: [number, number][][], properties: Record<string, unknown> = {}): Feature<MultiLineString> {
  return {
    type: 'Feature',
    properties,
    geometry: { type: 'MultiLineString', coordinates: coordArrays },
  };
}

describe('buildTiles', () => {
  it('assigns a feature to the tile containing its coordinates', () => {
    // Coordinates in the tile at lat=45, lng=-76 (floor of 45.4, -75.6 → 45, -76)
    const fc = makeFeatureCollection(
      makeLine([[-75.6, 45.4], [-75.5, 45.3]])
    );
    const input = new Map([['12345', fc]]);
    const { tiles, manifest } = buildTiles(input);

    expect(tiles.size).toBe(1);
    const tileId = '45_-76';
    const tile = tiles.get(tileId);
    expect(tile).toBeDefined();
    expect(tile!.features).toHaveLength(1);
    expect(tile!.features[0].properties?._geoId).toBe('12345');
    expect(tile!.features[0].properties?._fid).toBe('12345:0');

    expect(manifest).toHaveLength(1);
    expect(manifest[0].id).toBe(tileId);
    expect(manifest[0].featureCount).toBe(1);
    expect(manifest[0].file).toBe('tile-45_-76.geojson');
  });

  it('assigns a cross-boundary feature to both tiles', () => {
    // Coordinates spanning two 1-degree tiles: lat=45,lng=-76 and lat=45,lng=-75
    const fc = makeFeatureCollection(
      makeLine([[-75.6, 45.4], [-74.8, 45.2]])
    );
    const input = new Map([['99999', fc]]);
    const { tiles } = buildTiles(input);

    expect(tiles.size).toBe(2);
    expect(tiles.has('45_-76')).toBe(true);
    expect(tiles.has('45_-75')).toBe(true);

    // Feature appears in both tiles
    expect(tiles.get('45_-76')!.features).toHaveLength(1);
    expect(tiles.get('45_-75')!.features).toHaveLength(1);
  });

  it('computes actual bounding box for manifest entries', () => {
    const fc = makeFeatureCollection(
      makeLine([[-75.6, 45.4], [-75.5, 45.3], [-75.7, 45.1]])
    );
    const input = new Map([['bbox-test', fc]]);
    const { manifest } = buildTiles(input);

    expect(manifest).toHaveLength(1);
    const [minLng, minLat, maxLng, maxLat] = manifest[0].bounds;
    expect(minLng).toBe(-75.7);
    expect(minLat).toBe(45.1);
    expect(maxLng).toBe(-75.5);
    expect(maxLat).toBe(45.4);
  });

  it('preserves original feature properties alongside _geoId and _fid', () => {
    const fc = makeFeatureCollection(
      makeLine([[-75.6, 45.4], [-75.5, 45.3]], { wayId: 123, sourceId: 456 })
    );
    const input = new Map([['prop-test', fc]]);
    const { tiles } = buildTiles(input);

    const feature = [...tiles.values()][0].features[0];
    expect(feature.properties?.wayId).toBe(123);
    expect(feature.properties?.sourceId).toBe(456);
    expect(feature.properties?._geoId).toBe('prop-test');
    expect(feature.properties?._fid).toBe('prop-test:0');
  });

  it('handles multiple features per file with sequential _fid index', () => {
    const fc = makeFeatureCollection(
      makeLine([[-75.6, 45.4], [-75.5, 45.3]]),
      makeLine([[-75.4, 45.2], [-75.3, 45.1]]),
      makeMultiLine([[[-75.6, 45.4], [-75.5, 45.3]], [[-74.8, 45.2], [-74.7, 45.1]]])
    );
    const input = new Map([['multi', fc]]);
    const { tiles } = buildTiles(input);

    // Collect all features across all tiles
    const allFeatures = [...tiles.values()].flatMap(t => t.features);
    const fids = allFeatures.map(f => f.properties?._fid);

    expect(fids).toContain('multi:0');
    expect(fids).toContain('multi:1');
    expect(fids).toContain('multi:2');
  });
});
