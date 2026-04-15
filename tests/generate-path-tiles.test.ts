import { describe, it, expect } from 'vitest';
import { buildTiles, findCanonicalTargetConflicts, type GeoMetaEntry } from '../scripts/generate-path-tiles';
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

  it('emits a single _segments entry for a single-named asphalt path', () => {
    const input = new Map([
      [
        'geo-1',
        fc(
          line([[-75.7, 45.4], [-75.69, 45.4]], { name: 'Path #15', surface: 'asphalt' }),
          line([[-75.69, 45.4], [-75.68, 45.4]], { name: 'Path #15', surface: 'asphalt' }),
        ),
      ],
    ]);
    const { tiles } = buildTiles(input, new Map([['geo-1', meta({ slug: 'foo' })]]));

    const features = allFeatures(tiles);
    expect(features).toHaveLength(1);
    const f = features[0];
    const segments = (f.properties as any)._segments;
    expect(Array.isArray(segments)).toBe(true);
    expect(segments).toHaveLength(1);
    expect(segments[0].name).toBe('Path #15');
    expect(segments[0].surface_mix[0].value).toBe('asphalt');
    expect(segments[0].lineCount).toBe(2);
  });

  it('emits one _segments entry per distinct name, in contiguous-ordering', () => {
    const input = new Map([
      [
        'geo-2',
        fc(
          line([[-75.7, 45.4], [-75.69, 45.4]], { name: 'Path #15', surface: 'asphalt' }),
          line([[-75.69, 45.4], [-75.68, 45.4]], { name: 'Chemin Kingsmere', surface: 'asphalt' }),
          line([[-75.68, 45.4], [-75.67, 45.4]], { name: 'Path #15', surface: 'asphalt' }),
        ),
      ],
    ]);
    const { tiles } = buildTiles(input, new Map([['geo-2', meta({ slug: 'foo' })]]));

    const features = allFeatures(tiles);
    expect(features).toHaveLength(1);
    const f = features[0];
    const segments = (f.properties as any)._segments;
    expect(segments).toHaveLength(2);

    // Contiguous ordering invariant: lineCount sum equals geometry line count
    const totalLineCount = segments.reduce((acc: number, s: any) => acc + s.lineCount, 0);
    const geomLineCount = f.geometry.type === 'MultiLineString'
      ? (f.geometry as any).coordinates.length
      : 1;
    expect(totalLineCount).toBe(geomLineCount);

    // Path #15 has 2 ways, Chemin Kingsmere has 1 — lineCounts sum correctly
    const pathSeg = segments.find((s: any) => s.name === 'Path #15');
    const kingSeg = segments.find((s: any) => s.name === 'Chemin Kingsmere');
    expect(pathSeg.lineCount).toBe(2);
    expect(kingSeg.lineCount).toBe(1);
  });

  it('duplicates a mixed-surface segment across road and gravel features with identical surface_mix', () => {
    // Path #15 has two asphalt ways (→ road feature) and one gravel
    // way (→ gravel feature). Both features should contain a Path #15
    // segment with the same full surface_mix, and per-feature lineCount
    // reflecting only that category's ways.
    const input = new Map([
      [
        'geo-3',
        fc(
          line([[-75.7, 45.4], [-75.69, 45.4]], { name: 'Path #15', surface: 'asphalt' }),
          line([[-75.69, 45.4], [-75.68, 45.4]], { name: 'Path #15', surface: 'asphalt' }),
          line([[-75.68, 45.4], [-75.67, 45.4]], { name: 'Path #15', surface: 'gravel' }),
        ),
      ],
    ]);
    const { tiles } = buildTiles(input, new Map([['geo-3', meta({ slug: 'foo' })]]));

    const features = allFeatures(tiles);
    expect(features).toHaveLength(2); // road and gravel features

    const road = features.find(f => (f.properties as any).surface_category === 'road');
    const gravel = features.find(f => (f.properties as any).surface_category === 'gravel');
    expect(road).toBeDefined();
    expect(gravel).toBeDefined();

    const roadSegs = (road!.properties as any)._segments;
    const gravelSegs = (gravel!.properties as any)._segments;
    expect(roadSegs).toHaveLength(1);
    expect(gravelSegs).toHaveLength(1);

    // Same name in both
    expect(roadSegs[0].name).toBe('Path #15');
    expect(gravelSegs[0].name).toBe('Path #15');

    // Identical segment-wide surface_mix (includes both asphalt and gravel)
    expect(roadSegs[0].surface_mix).toEqual(gravelSegs[0].surface_mix);
    expect(roadSegs[0].surface_mix).toHaveLength(2);

    // Per-feature lineCount reflects ONLY that category's ways
    expect(roadSegs[0].lineCount).toBe(2);
    expect(gravelSegs[0].lineCount).toBe(1);
  });

  it('duplicates a segment across all three surface categories with identical surface_mix', () => {
    const input = new Map([
      [
        'geo-5',
        fc(
          line([[-75.7, 45.4], [-75.69, 45.4]], { name: 'Path #15', surface: 'asphalt' }),
          line([[-75.69, 45.4], [-75.68, 45.4]], { name: 'Path #15', surface: 'gravel' }),
          line([[-75.68, 45.4], [-75.67, 45.4]], { name: 'Path #15', surface: 'ground' }),
        ),
      ],
    ]);
    const { tiles } = buildTiles(input, new Map([['geo-5', meta({ slug: 'foo' })]]));

    const features = allFeatures(tiles);
    expect(features).toHaveLength(3);

    const byCat: Record<string, any> = {};
    for (const f of features) {
      byCat[(f.properties as any).surface_category] = f;
    }
    expect(byCat.road).toBeDefined();
    expect(byCat.gravel).toBeDefined();
    expect(byCat.mtb).toBeDefined();

    const roadSegs = (byCat.road.properties as any)._segments;
    const gravelSegs = (byCat.gravel.properties as any)._segments;
    const mtbSegs = (byCat.mtb.properties as any)._segments;

    expect(roadSegs).toHaveLength(1);
    expect(gravelSegs).toHaveLength(1);
    expect(mtbSegs).toHaveLength(1);

    // All three copies of the segment carry the same full surface_mix
    expect(roadSegs[0].surface_mix).toEqual(gravelSegs[0].surface_mix);
    expect(roadSegs[0].surface_mix).toEqual(mtbSegs[0].surface_mix);
    expect(roadSegs[0].surface_mix).toHaveLength(3);

    // Per-category lineCount — each got exactly one way
    expect(roadSegs[0].lineCount).toBe(1);
    expect(gravelSegs[0].lineCount).toBe(1);
    expect(mtbSegs[0].lineCount).toBe(1);

    // Contiguous-ordering invariant: per-feature lineCount sum = geometry line count
    for (const f of [byCat.road, byCat.gravel, byCat.mtb]) {
      const segs = (f.properties as any)._segments;
      const totalLineCount = segs.reduce((acc: number, s: any) => acc + s.lineCount, 0);
      const geomLineCount = f.geometry.type === 'MultiLineString'
        ? (f.geometry as any).coordinates.length
        : 1;
      expect(totalLineCount).toBe(geomLineCount);
    }
  });

  it('collapses unnamed ways into a single {name: undefined} segment per feature', () => {
    const input = new Map([
      [
        'geo-4',
        fc(
          line([[-75.7, 45.4], [-75.69, 45.4]], { surface: 'asphalt' }),
          line([[-75.69, 45.4], [-75.68, 45.4]], { surface: 'asphalt' }),
          line([[-75.68, 45.4], [-75.67, 45.4]], { surface: 'asphalt' }),
        ),
      ],
    ]);
    const { tiles } = buildTiles(input, new Map([['geo-4', meta({ slug: 'foo' })]]));
    const features = allFeatures(tiles);
    expect(features).toHaveLength(1);
    const segments = (features[0].properties as any)._segments;
    expect(segments).toHaveLength(1);
    expect(segments[0].name).toBeUndefined();
    expect(segments[0].lineCount).toBe(3);
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
    expect(props.surface_category).toBe('gravel');
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
    expect(props.surface_category).toBe('mtb'); // unknown surface defaults to mtb
    expect(props.hasPage).toBe(false);
    expect(props.path_type).toBe('');
    expect(props.length_km).toBe(0);
  });

  it('excludes features when metadata map exists but does not contain the geoId', () => {
    const input = new Map([
      ['geo-missing', fc(line([[-75.6, 45.4], [-75.5, 45.3]]))],
    ]);
    const metadata = new Map([['other-id', meta()]]);
    const { tiles } = buildTiles(input, metadata);

    const features = allFeatures(tiles);
    expect(features).toHaveLength(0);
  });

  it('splits features by surface category (road/gravel/mtb)', () => {
    const input = new Map([
      [
        'mixed-path',
        fc(
          line([[-75.6, 45.4], [-75.5, 45.3]], { surface: 'asphalt' }),
          line([[-75.4, 45.2], [-75.3, 45.1]], { surface: 'gravel' }),
          line([[-75.2, 45.0], [-75.1, 44.9]], { surface: 'ground' }),
        ),
      ],
    ]);
    const metadata = new Map([
      ['mixed-path', meta({ slug: 'mixed-path', path_type: 'trail', surface: 'gravel' })],
    ]);
    const { tiles } = buildTiles(input, metadata);

    const features = allFeatures(tiles);
    expect(features).toHaveLength(3);

    const road = features.find(f => f.properties!.surface_category === 'road');
    const gravel = features.find(f => f.properties!.surface_category === 'gravel');
    const mtb = features.find(f => f.properties!.surface_category === 'mtb');
    expect(road).toBeDefined();
    expect(gravel).toBeDefined();
    expect(mtb).toBeDefined();
    expect(road!.properties!._fid).toBe('mixed-path:road');
    expect(gravel!.properties!._fid).toBe('mixed-path:gravel');
    expect(mtb!.properties!._fid).toBe('mixed-path:mtb');
  });

  it('splits non-trail paths by surface too', () => {
    const input = new Map([
      [
        'mup-mixed',
        fc(
          line([[-75.6, 45.4], [-75.5, 45.3]], { surface: 'asphalt' }),
          line([[-75.4, 45.2], [-75.3, 45.1]], { surface: 'gravel' }),
        ),
      ],
    ]);
    const metadata = new Map([
      ['mup-mixed', meta({ slug: 'mup-mixed', path_type: 'mup', surface: 'asphalt' })],
    ]);
    const { tiles } = buildTiles(input, metadata);

    const features = allFeatures(tiles);
    expect(features).toHaveLength(2);
    expect(features.map(f => f.properties!.surface_category).sort()).toEqual(['gravel', 'road']);
  });

  it('falls back to metadata surface when ways have no surface tag', () => {
    const input = new Map([
      [
        'path-nosurface',
        fc(
          line([[-75.6, 45.4], [-75.5, 45.3]]),
          line([[-75.4, 45.2], [-75.3, 45.1]]),
        ),
      ],
    ]);
    const metadata = new Map([
      ['path-nosurface', meta({ slug: 'path-nosurface', path_type: 'trail', surface: 'gravel' })],
    ]);
    const { tiles } = buildTiles(input, metadata);

    const features = allFeatures(tiles);
    expect(features).toHaveLength(1);
    expect(features[0].properties!.surface_category).toBe('gravel');
  });

  it('sets surface_category on single-surface paths', () => {
    const input = new Map([
      ['paved-path', fc(line([[-75.6, 45.4], [-75.5, 45.3]]))],
    ]);
    const metadata = new Map([
      ['paved-path', meta({ slug: 'paved-path', surface: 'asphalt' })],
    ]);
    const { tiles } = buildTiles(input, metadata);

    const features = allFeatures(tiles);
    expect(features).toHaveLength(1);
    expect(features[0].properties!.surface_category).toBe('road');
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
    // A small number of features well within the default 300,000 coord budget
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

// ── Failing tests: stale geometry produces ghost features ────────

describe('ghost feature exclusion', () => {
  // The tile generator reads ALL geojson files from the cache directory,
  // but some are stale (from previous pipeline runs). These produce
  // features with no metadata — empty slug, empty name, hasPage: false.
  // 74.5% of Ottawa's tile features are ghosts.
  //
  // buildTiles should exclude features that have no metadata entry.

  it('excludes features without metadata when metadata map is provided', () => {
    const metadata = new Map<string, GeoMetaEntry>([
      ['known-path', { slug: 'known-path', name: 'Known Path', memberOf: '', surface: 'asphalt', hasPage: true, path_type: 'mup', length_km: 2 }],
    ]);

    const input = new Map<string, FeatureCollection>([
      ['known-path', fc(line([[-75.6, 45.4], [-75.5, 45.3]]))],
      ['stale-ghost', fc(line([[-75.4, 45.2], [-75.3, 45.1]]))],
    ]);

    const { tiles } = buildTiles(input, metadata);

    // Collect all geoIds from tile features
    const geoIds = new Set<string>();
    for (const tile of tiles.values()) {
      for (const f of tile.features) {
        geoIds.add(f.properties!._geoId as string);
      }
    }

    expect(geoIds).toContain('known-path');
    expect(geoIds).not.toContain('stale-ghost');
  });

  it('every tile feature has a non-empty slug when metadata is provided', () => {
    const metadata = new Map<string, GeoMetaEntry>([
      ['path-a', { slug: 'path-a', name: 'Path A', memberOf: '', surface: 'asphalt', hasPage: true, path_type: 'mup', length_km: 1 }],
    ]);

    const input = new Map<string, FeatureCollection>([
      ['path-a', fc(line([[-75.6, 45.4], [-75.5, 45.3]]))],
      ['orphan-1', fc(line([[-75.4, 45.2], [-75.3, 45.1]]))],
      ['orphan-2', fc(line([[-75.2, 45.0], [-75.1, 44.9]]))],
    ]);

    const { tiles } = buildTiles(input, metadata);

    for (const tile of tiles.values()) {
      for (const f of tile.features) {
        expect(f.properties!.slug, `feature ${f.properties!._geoId} has empty slug`).not.toBe('');
      }
    }
  });
});

// ── Canonical-target invariant ────────────────────────────────────
//
// The invariant we care about on the tile side is: *one physical clickable
// path segment → one canonical page target*. At the OSM layer that means
// no OSM way ID should appear in the cache of two entries that resolve to
// different slugs. Same slug + multiple geo sources is fine (a single page
// can aggregate ways from several relations); different slugs means the
// user's click is ambiguous and the map will open whichever popup MapLibre
// happens to return first. That's the bug class behind Parc de la Gatineau
// and Scott Street.
//
// This helper is the ground-truth check. It should find zero conflicts on
// clean input and should flag the overlap on dirty input. Regressions that
// reintroduce parallel discovery for network entries, or order-dependent
// ghost removal, will surface here first.

describe('findCanonicalTargetConflicts', () => {
  function featWithWay(wayId: number): Feature {
    return {
      type: 'Feature',
      properties: { wayId, sourceId: 'test' },
      geometry: { type: 'LineString', coordinates: [[-75, 45], [-74.99, 45.01]] },
    };
  }

  it('returns no conflicts when every wayId lives under a single slug', () => {
    const input = new Map<string, FeatureCollection>([
      ['ways-a', fc(featWithWay(1), featWithWay(2))],
      ['ways-b', fc(featWithWay(3), featWithWay(4))],
    ]);
    const metadata = new Map<string, GeoMetaEntry>([
      ['ways-a', meta({ slug: 'a' })],
      ['ways-b', meta({ slug: 'b' })],
    ]);
    expect(findCanonicalTargetConflicts(input, metadata)).toEqual([]);
  });

  it('allows the same wayId to live in multiple cache files of the SAME slug', () => {
    // A single page can aggregate geometry from several osm_relations or
    // from a relation plus a named-way fallback. That produces multiple
    // geoIds sharing ways, but the canonical target is still one page.
    const input = new Map<string, FeatureCollection>([
      ['7234399', fc(featWithWay(100), featWithWay(101))],
      ['ways-crosstown-extras', fc(featWithWay(100))],
    ]);
    const metadata = new Map<string, GeoMetaEntry>([
      ['7234399', meta({ slug: 'eastwest-crosstown-bikeway' })],
      ['ways-crosstown-extras', meta({ slug: 'eastwest-crosstown-bikeway' })],
    ]);
    expect(findCanonicalTargetConflicts(input, metadata)).toEqual([]);
  });

  it('flags a wayId claimed under two different slugs (Parc de la Gatineau shape)', () => {
    // Network entry's auto-discovered name file contains member ways.
    // Member entry's own ways file contains the same way. Both land under
    // different slugs: the click target is ambiguous.
    const input = new Map<string, FeatureCollection>([
      ['name-parc-de-la-gatineau', fc(featWithWay(437171896), featWithWay(111), featWithWay(222))],
      ['ways-77-happy-valley', fc(featWithWay(437171896))],
    ]);
    const metadata = new Map<string, GeoMetaEntry>([
      ['name-parc-de-la-gatineau', meta({ slug: 'parc-de-la-gatineau' })],
      ['ways-77-happy-valley', meta({ slug: '77-happy-valley', memberOf: 'parc-de-la-gatineau' })],
    ]);
    const conflicts = findCanonicalTargetConflicts(input, metadata);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].wayId).toBe(437171896);
    expect(new Set(conflicts[0].slugs)).toEqual(new Set(['parc-de-la-gatineau', '77-happy-valley']));
  });

  it('flags the Scott Street / Crosstown Bikeway shape (parallel ghost)', () => {
    // A relation-derived bikeway and a parallel-lane discovery overlap on
    // many ways. Ghost removal should catch this upstream; if it doesn't,
    // the overlap surfaces here.
    const input = new Map<string, FeatureCollection>([
      ['7234399', fc(featWithWay(1), featWithWay(2), featWithWay(3), featWithWay(4))],
      ['parallel-scott-street', fc(featWithWay(1), featWithWay(2), featWithWay(99))],
    ]);
    const metadata = new Map<string, GeoMetaEntry>([
      ['7234399', meta({ slug: 'eastwest-crosstown-bikeway' })],
      ['parallel-scott-street', meta({ slug: 'scott-street' })],
    ]);
    const conflicts = findCanonicalTargetConflicts(input, metadata);
    const conflictedWays = new Set(conflicts.map(c => c.wayId));
    expect(conflictedWays).toEqual(new Set([1, 2]));
  });

  it('ignores geoIds that have no metadata entry (stale cache files)', () => {
    // Stale cache files without a page claiming them are already excluded
    // by buildTiles. Don't let them influence the invariant check either.
    const input = new Map<string, FeatureCollection>([
      ['ways-a', fc(featWithWay(1))],
      ['name-orphan', fc(featWithWay(1))],
    ]);
    const metadata = new Map<string, GeoMetaEntry>([
      ['ways-a', meta({ slug: 'a' })],
      // name-orphan is intentionally missing
    ]);
    expect(findCanonicalTargetConflicts(input, metadata)).toEqual([]);
  });
});
