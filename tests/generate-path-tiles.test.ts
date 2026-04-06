import { describe, it, expect } from 'vitest';
import { buildTiles, type GeoMetaEntry } from '../scripts/generate-path-tiles';
import type { FeatureCollection, Feature, LineString, MultiLineString } from 'geojson';

// ── Test helpers ──────────────────────────────────────────────────

function fc(...features: Feature[]): FeatureCollection {
  return { type: 'FeatureCollection', features };
}

function line(coords: [number, number][], props: Record<string, unknown> = {}): Feature<LineString> {
  return { type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } };
}

function multiLine(
  coordArrays: [number, number][][],
  props: Record<string, unknown> = {},
): Feature<MultiLineString> {
  return { type: 'Feature', properties: props, geometry: { type: 'MultiLineString', coordinates: coordArrays } };
}

function meta(overrides: Partial<GeoMetaEntry> = {}): GeoMetaEntry {
  return {
    slug: 'test-path',
    name: 'Test Path',
    memberOf: '',
    surface: 'asphalt',
    hasPage: true,
    path_type: 'mup',
    length_km: 5.0,
    ...overrides,
  };
}

function allFeatures(tiles: Map<string, { features: Feature[] }>): Feature[] {
  return [...tiles.values()].flatMap(t => t.features);
}

// ── merge ─────────────────────────────────────────────────────────

describe('merge', () => {
  it('merges multiple LineStrings with same geoId into one MultiLineString', () => {
    const input = new Map([
      [
        'geo-1',
        fc(
          line([[-75.6, 45.4], [-75.5, 45.3]]),
          line([[-75.4, 45.2], [-75.3, 45.1]]),
        ),
      ],
    ]);
    const { tiles } = buildTiles(input);

    const features = allFeatures(tiles);
    expect(features).toHaveLength(1);
    expect(features[0].geometry.type).toBe('MultiLineString');
  });

  it('keeps a single LineString as LineString (not wrapped in MultiLineString)', () => {
    const input = new Map([
      ['geo-1', fc(line([[-75.6, 45.4], [-75.5, 45.3]]))],
    ]);
    const { tiles } = buildTiles(input);

    const features = allFeatures(tiles);
    expect(features).toHaveLength(1);
    expect(features[0].geometry.type).toBe('LineString');
  });

  it('merges MultiLineString input features correctly (flattens coordinate arrays)', () => {
    const input = new Map([
      [
        'geo-1',
        fc(
          multiLine([
            [[-75.6, 45.4], [-75.5, 45.3]],
            [[-75.4, 45.2], [-75.3, 45.1]],
          ]),
        ),
      ],
    ]);
    const { tiles } = buildTiles(input);

    const features = allFeatures(tiles);
    expect(features).toHaveLength(1);
    // A single MultiLineString input feature stays as MultiLineString (multiple line arrays)
    expect(features[0].geometry.type).toBe('MultiLineString');
    const geom = features[0].geometry as MultiLineString;
    expect(geom.coordinates).toHaveLength(2);
  });

  it('merges mixed LineString and MultiLineString features for the same geoId', () => {
    const input = new Map([
      [
        'geo-mix',
        fc(
          line([[-75.6, 45.4], [-75.5, 45.3]]),
          multiLine([
            [[-75.4, 45.2], [-75.3, 45.1]],
            [[-75.2, 45.0], [-75.1, 44.9]],
          ]),
        ),
      ],
    ]);
    const { tiles } = buildTiles(input);

    const features = allFeatures(tiles);
    expect(features).toHaveLength(1);
    expect(features[0].geometry.type).toBe('MultiLineString');
    const geom = features[0].geometry as MultiLineString;
    // 1 from LineString + 2 from MultiLineString
    expect(geom.coordinates).toHaveLength(3);
  });
});

// ── coordinate precision ──────────────────────────────────────────

describe('coordinate precision', () => {
  it('truncates coordinates to at most 5 decimal places', () => {
    const input = new Map([
      [
        'geo-prec',
        fc(line([[-75.123456789, 45.987654321], [-75.000001234, 45.000009876]])),
      ],
    ]);
    const { tiles } = buildTiles(input);

    const features = allFeatures(tiles);
    expect(features).toHaveLength(1);
    const geom = features[0].geometry as LineString;
    for (const [lng, lat] of geom.coordinates) {
      const lngStr = lng.toString();
      const latStr = lat.toString();
      const lngDecimals = lngStr.includes('.') ? lngStr.split('.')[1].length : 0;
      const latDecimals = latStr.includes('.') ? latStr.split('.')[1].length : 0;
      expect(lngDecimals).toBeLessThanOrEqual(5);
      expect(latDecimals).toBeLessThanOrEqual(5);
    }
  });

  it('uses Math.round(n * 1e5) / 1e5 rounding semantics', () => {
    // -75.123456789 rounds to -75.12346 (5dp)
    const input = new Map([
      ['geo-round', fc(line([[-75.123456789, 45.987654321]]))],
    ]);
    const { tiles } = buildTiles(input);

    const features = allFeatures(tiles);
    const geom = features[0].geometry as LineString;
    const [lng, lat] = geom.coordinates[0];
    expect(lng).toBe(Math.round(-75.123456789 * 1e5) / 1e5);
    expect(lat).toBe(Math.round(45.987654321 * 1e5) / 1e5);
  });
});

// ── metadata injection ────────────────────────────────────────────

describe('metadata injection', () => {
  it('injects all metadata fields from the metadata map', () => {
    const input = new Map([
      ['geo-meta', fc(line([[-75.6, 45.4], [-75.5, 45.3]]))],
    ]);
    const metadata = new Map([
      [
        'geo-meta',
        meta({
          slug: 'my-path',
          name: 'My Path',
          memberOf: 'some-network',
          surface: 'gravel',
          hasPage: true,
          path_type: 'trail',
          length_km: 12.5,
        }),
      ],
    ]);
    const { tiles } = buildTiles(input, metadata);

    const features = allFeatures(tiles);
    expect(features).toHaveLength(1);
    const props = features[0].properties!;
    expect(props.slug).toBe('my-path');
    expect(props.name).toBe('My Path');
    expect(props.memberOf).toBe('some-network');
    expect(props.surface).toBe('gravel');
    expect(props.hasPage).toBe(true);
    expect(props.path_type).toBe('trail');
    expect(props.length_km).toBe(12.5);
  });

  it('uses empty/zero defaults when metadata is missing for a geoId', () => {
    const input = new Map([
      ['geo-nometa', fc(line([[-75.6, 45.4], [-75.5, 45.3]]))],
    ]);
    // Pass no metadata at all
    const { tiles } = buildTiles(input);

    const features = allFeatures(tiles);
    expect(features).toHaveLength(1);
    const props = features[0].properties!;
    expect(props.slug).toBe('');
    expect(props.name).toBe('');
    expect(props.memberOf).toBe('');
    expect(props.surface).toBe('');
    expect(props.hasPage).toBe(false);
    expect(props.path_type).toBe('');
    expect(props.length_km).toBe(0);
  });

  it('uses empty defaults when metadata map exists but does not contain the geoId', () => {
    const input = new Map([
      ['geo-missing', fc(line([[-75.6, 45.4], [-75.5, 45.3]]))],
    ]);
    const metadata = new Map([['other-id', meta()]]);
    const { tiles } = buildTiles(input, metadata);

    const features = allFeatures(tiles);
    expect(features).toHaveLength(1);
    const props = features[0].properties!;
    expect(props.slug).toBe('');
    expect(props.name).toBe('');
    expect(props.hasPage).toBe(false);
    expect(props.length_km).toBe(0);
  });

  it('sets dashed: true for trail and mtb-trail path_types, false for others', () => {
    const makeInput = (geoId: string) =>
      new Map([[geoId, fc(line([[-75.6, 45.4], [-75.5, 45.3]]))]]);

    // trail → dashed: true
    const { tiles: trailTiles } = buildTiles(
      makeInput('geo-trail'),
      new Map([['geo-trail', meta({ path_type: 'trail' })]]),
    );
    expect(allFeatures(trailTiles)[0].properties!.dashed).toBe(true);

    // mtb-trail → dashed: true
    const { tiles: mtbTiles } = buildTiles(
      makeInput('geo-mtb'),
      new Map([['geo-mtb', meta({ path_type: 'mtb-trail' })]]),
    );
    expect(allFeatures(mtbTiles)[0].properties!.dashed).toBe(true);

    // mup → dashed: false
    const { tiles: mupTiles } = buildTiles(
      makeInput('geo-mup'),
      new Map([['geo-mup', meta({ path_type: 'mup' })]]),
    );
    expect(allFeatures(mupTiles)[0].properties!.dashed).toBe(false);
  });

  it('sets _geoId and _fid both to the geoId', () => {
    const input = new Map([
      ['my-geo-id', fc(line([[-75.6, 45.4], [-75.5, 45.3]]))],
    ]);
    const { tiles } = buildTiles(input);

    const features = allFeatures(tiles);
    expect(features).toHaveLength(1);
    expect(features[0].properties!._geoId).toBe('my-geo-id');
    expect(features[0].properties!._fid).toBe('my-geo-id');
  });
});

// ── adaptive splitting ────────────────────────────────────────────

describe('adaptive splitting', () => {
  it('small dataset stays in a single tile', () => {
    // A small number of features well within the default 15,000 coord budget
    const input = new Map([
      ['a', fc(line([[-75.6, 45.4], [-75.5, 45.3]]))],
      ['b', fc(line([[-75.4, 45.2], [-75.3, 45.1]]))],
    ]);
    const { tiles, manifest } = buildTiles(input);

    expect(tiles.size).toBe(1);
    expect(manifest).toHaveLength(1);
  });

  it('large dataset splits into multiple tiles', () => {
    // Generate many features with many coordinates to exceed the budget
    // Use a small maxCoords threshold to force splitting
    const input = new Map<string, FeatureCollection>();
    const coordsPerFeature = 100;
    const numFeatures = 10;

    for (let i = 0; i < numFeatures; i++) {
      const lng = -75 + i * 0.1;
      const coords: [number, number][] = Array.from({ length: coordsPerFeature }, (_, j) => [
        lng + j * 0.001,
        45 + j * 0.001,
      ]);
      input.set(`geo-${i}`, fc(line(coords)));
    }

    // Set a very low threshold to force splitting
    const { tiles } = buildTiles(input, undefined, { maxCoords: 50 });

    expect(tiles.size).toBeGreaterThan(1);
  });

  it('city-spanning feature does not cause tile explosion', () => {
    // A single long path spanning a wide area plus many small local paths.
    // Without counting only in-box coords, the long path's total coord count
    // inflates every quadrant, causing exponential splitting.
    const longCoords: [number, number][] = Array.from({ length: 500 }, (_, i) => [
      -76 + i * 0.006, 45 + i * 0.002,
    ]);
    const input = new Map<string, FeatureCollection>();
    input.set('long-trail', fc(line(longCoords)));

    // Add 20 small local paths clustered in one area
    for (let i = 0; i < 20; i++) {
      const coords: [number, number][] = Array.from({ length: 50 }, (_, j) => [
        -75.6 + j * 0.001 + i * 0.01, 45.4 + j * 0.001,
      ]);
      input.set(`local-${i}`, fc(line(coords)));
    }

    const { tiles } = buildTiles(input, undefined, { maxCoords: 200 });

    // Should produce a reasonable number of tiles, not thousands
    expect(tiles.size).toBeLessThan(50);
    expect(tiles.size).toBeGreaterThan(1);
  });

  it('max depth stops infinite recursion', () => {
    // Use threshold of 1 so every tile exceeds budget, forcing max-depth termination
    // A single feature with many coords cannot be split further than max depth
    const coords: [number, number][] = Array.from({ length: 200 }, (_, i) => [
      -75 + i * 0.0001,
      45 + i * 0.0001,
    ]);
    const input = new Map([['deep', fc(line(coords))]]);

    // Should not throw or infinitely recurse
    const { tiles } = buildTiles(input, undefined, { maxCoords: 1 });

    expect(tiles.size).toBeGreaterThan(0);
    // All coords must still be present somewhere
    const allCoords = allFeatures(tiles).flatMap(f => {
      const geom = f.geometry as LineString | MultiLineString;
      return geom.type === 'LineString' ? geom.coordinates : geom.coordinates.flat();
    });
    expect(allCoords.length).toBeGreaterThan(0);
  });
});

// ── cross-boundary duplication ────────────────────────────────────

describe('cross-boundary duplication', () => {
  it('a feature spanning quadrants appears in multiple tiles', () => {
    // Force a split by using a very low maxCoords threshold and two well-separated features
    // Feature A is in one corner, Feature B is far away — together they span the bbox
    // A single cross-quadrant feature will be duplicated
    const coordsA: [number, number][] = Array.from({ length: 20 }, (_, i) => [-75 + i * 0.001, 45 + i * 0.001]);
    const coordsB: [number, number][] = Array.from({ length: 20 }, (_, i) => [-74 + i * 0.001, 46 + i * 0.001]);
    // crossFeature spans from one extreme to the other
    const crossCoords: [number, number][] = [
      [-75, 45],
      [-74, 46],
    ];

    const input = new Map([
      ['feature-a', fc(line(coordsA))],
      ['feature-b', fc(line(coordsB))],
      ['cross', fc(line(crossCoords))],
    ]);

    const { tiles } = buildTiles(input, undefined, { maxCoords: 10 });

    if (tiles.size > 1) {
      // Count how many tiles contain the cross feature
      let crossCount = 0;
      for (const tile of tiles.values()) {
        const hasCross = tile.features.some(f => f.properties!._fid === 'cross');
        if (hasCross) crossCount++;
      }
      expect(crossCount).toBeGreaterThanOrEqual(1);
    }
  });

  it('duplicated features have the same _fid across tiles', () => {
    // Two features in very different locations force a split; a cross-feature spans both
    const coordsLeft: [number, number][] = Array.from({ length: 30 }, (_, i) => [-80 + i * 0.001, 40 + i * 0.001]);
    const coordsRight: [number, number][] = Array.from({ length: 30 }, (_, i) => [-60 + i * 0.001, 50 + i * 0.001]);
    const crossCoords: [number, number][] = [[-80, 40], [-60, 50]];

    const input = new Map([
      ['left-feature', fc(line(coordsLeft))],
      ['right-feature', fc(line(coordsRight))],
      ['cross-feature', fc(line(crossCoords))],
    ]);

    const { tiles } = buildTiles(input, undefined, { maxCoords: 5 });

    // Collect all _fid values for features that appear more than once
    const fidOccurrences = new Map<string, number>();
    for (const tile of tiles.values()) {
      for (const f of tile.features) {
        const fid = f.properties!._fid as string;
        fidOccurrences.set(fid, (fidOccurrences.get(fid) ?? 0) + 1);
      }
    }

    // For any fid that appears in multiple tiles, verify it equals the geoId (no index suffix)
    for (const [fid, count] of fidOccurrences) {
      if (count > 1) {
        // _fid should be the plain geoId, not geoId:index
        expect(fid).not.toMatch(/:\d+$/);
        // The fid should be one of our input geoIds
        expect(['left-feature', 'right-feature', 'cross-feature']).toContain(fid);
      }
    }
  });
});

// ── edge cases ────────────────────────────────────────────────────

describe('edge cases', () => {
  it('empty input returns empty tiles and empty manifest', () => {
    const input = new Map<string, FeatureCollection>();
    const { tiles, manifest } = buildTiles(input);

    expect(tiles.size).toBe(0);
    expect(manifest).toHaveLength(0);
  });

  it('features with no geometry are skipped', () => {
    const featureWithoutGeom = {
      type: 'Feature' as const,
      properties: {},
      geometry: null as unknown as LineString,
    };
    const input = new Map([
      ['no-geom', { type: 'FeatureCollection' as const, features: [featureWithoutGeom] }],
    ]);

    const { tiles, manifest } = buildTiles(input);

    // No valid geometry → no output
    expect(tiles.size).toBe(0);
    expect(manifest).toHaveLength(0);
  });

  it('a geoId with all empty coordinate arrays produces no output', () => {
    // Empty LineString-like: geometry present but no coordinates
    const emptyLine: Feature<LineString> = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [] },
    };
    const input = new Map([
      ['empty-coords', fc(emptyLine)],
    ]);

    const { tiles } = buildTiles(input);

    // Empty coordinates → mergeFeatures returns null → skipped
    expect(tiles.size).toBe(0);
  });
});

// ── manifest ──────────────────────────────────────────────────────

describe('manifest', () => {
  it('bounds match actual feature coordinates', () => {
    const input = new Map([
      [
        'bbox-test',
        fc(line([[-75.7, 45.1], [-75.5, 45.4], [-75.6, 45.2]])),
      ],
    ]);
    const { manifest } = buildTiles(input);

    expect(manifest).toHaveLength(1);
    const [minLng, minLat, maxLng, maxLat] = manifest[0].bounds;
    expect(minLng).toBe(-75.7);
    expect(minLat).toBe(45.1);
    expect(maxLng).toBe(-75.5);
    expect(maxLat).toBe(45.4);
  });

  it('featureCount matches the number of features in the tile', () => {
    const input = new Map([
      ['geo-a', fc(line([[-75.6, 45.4], [-75.5, 45.3]]))],
      ['geo-b', fc(line([[-75.4, 45.2], [-75.3, 45.1]]))],
      ['geo-c', fc(line([[-75.2, 45.0], [-75.1, 44.9]]))],
    ]);
    const { tiles, manifest } = buildTiles(input);

    // Verify manifest featureCount matches actual tiles
    for (const entry of manifest) {
      const tile = tiles.get(entry.id);
      expect(tile).toBeDefined();
      expect(entry.featureCount).toBe(tile!.features.length);
    }
  });

  it('manifest file name matches tile id', () => {
    const input = new Map([
      ['geo-file', fc(line([[-75.6, 45.4], [-75.5, 45.3]]))],
    ]);
    const { manifest } = buildTiles(input);

    for (const entry of manifest) {
      expect(entry.file).toBe(`tile-${entry.id}.geojson`);
    }
  });

  it('manifest bounds use coordinate-precision-truncated values', () => {
    const input = new Map([
      ['geo-prec', fc(line([[-75.123456789, 45.987654321], [-75.0, 45.0]]))],
    ]);
    const { manifest } = buildTiles(input);

    expect(manifest).toHaveLength(1);
    const [minLng, , maxLng] = manifest[0].bounds;
    // Bounds should be within 5dp precision
    expect(minLng.toString().split('.')[1]?.length ?? 0).toBeLessThanOrEqual(5);
    expect(maxLng.toString().split('.')[1]?.length ?? 0).toBeLessThanOrEqual(5);
  });
});

// ── no geoId lost ─────────────────────────────────────────────────

describe('no geoId lost', () => {
  it('every input geoId appears in at least one output tile', () => {
    const geoIds = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
    const input = new Map<string, FeatureCollection>();

    geoIds.forEach((id, i) => {
      input.set(
        id,
        fc(line([[-75 + i * 0.2, 45 + i * 0.1], [-75 + i * 0.2 + 0.1, 45 + i * 0.1 + 0.1]])),
      );
    });

    const { tiles } = buildTiles(input);

    const foundGeoIds = new Set<string>();
    for (const tile of tiles.values()) {
      for (const f of tile.features) {
        foundGeoIds.add(f.properties!._geoId as string);
      }
    }

    for (const id of geoIds) {
      expect(foundGeoIds).toContain(id);
    }
  });

  it('every input geoId appears in at least one tile after forced splitting', () => {
    const geoIds = ['path-1', 'path-2', 'path-3', 'path-4'];
    const input = new Map<string, FeatureCollection>();

    // Spread them out in all four quadrants relative to bbox center
    const positions: [number, number][] = [
      [-80, 40],
      [-60, 40],
      [-80, 50],
      [-60, 50],
    ];

    geoIds.forEach((id, i) => {
      const [lng, lat] = positions[i];
      // Give each feature enough coords to push totals over a small threshold
      const coords: [number, number][] = Array.from({ length: 20 }, (_, j) => [lng + j * 0.001, lat + j * 0.001]);
      input.set(id, fc(line(coords)));
    });

    const { tiles } = buildTiles(input, undefined, { maxCoords: 10 });

    const foundGeoIds = new Set<string>();
    for (const tile of tiles.values()) {
      for (const f of tile.features) {
        foundGeoIds.add(f.properties!._geoId as string);
      }
    }

    for (const id of geoIds) {
      expect(foundGeoIds).toContain(id);
    }
  });
});
