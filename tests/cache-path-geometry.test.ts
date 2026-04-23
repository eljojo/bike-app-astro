import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  overpassToGeoJSON,
  anchorBbox,
  buildNameQuery,
  cleanupOrphanedCacheFiles,
  verifyGeometryMatchesAnchors,
} from '../scripts/cache-path-geometry';
import type { Feature, LineString } from 'geojson';

describe('overpassToGeoJSON', () => {
  it('converts Overpass way elements to GeoJSON FeatureCollection with [lon, lat] coordinates', () => {
    const data = {
      elements: [
        {
          type: 'way',
          id: 12345,
          tags: { name: 'Path #15', surface: 'gravel' },
          geometry: [
            { lat: 45.4, lon: -75.7 },
            { lat: 45.41, lon: -75.71 },
          ],
        },
        {
          type: 'way',
          id: 67890,
          geometry: [
            { lat: 45.5, lon: -75.6 },
            { lat: 45.51, lon: -75.61 },
            { lat: 45.52, lon: -75.62 },
          ],
        },
      ],
    };

    const result = overpassToGeoJSON(data, 99999);

    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(2);

    // First feature: coordinates are [lon, lat], not [lat, lon]
    expect(result.features[0].geometry.type).toBe('LineString');
    expect((result.features[0].geometry as GeoJSON.LineString).coordinates).toEqual([
      [-75.7, 45.4],
      [-75.71, 45.41],
    ]);
    expect(result.features[0].properties).toEqual({
      wayId: 12345,
      sourceId: 99999,
      surface: 'gravel',
      name: 'Path #15',
    });

    // Second feature
    expect((result.features[1].geometry as GeoJSON.LineString).coordinates).toEqual([
      [-75.6, 45.5],
      [-75.61, 45.51],
      [-75.62, 45.52],
    ]);
    expect(result.features[1].properties).toEqual({
      wayId: 67890,
      sourceId: 99999,
      surface: '',
      name: '',
    });
  });

  it('skips non-way elements and elements without geometry', () => {
    const data = {
      elements: [
        { type: 'node', id: 1, lat: 45.4, lon: -75.7 },
        { type: 'relation', id: 2 },
        { type: 'way', id: 3 }, // no geometry
        {
          type: 'way',
          id: 4,
          geometry: [
            { lat: 45.4, lon: -75.7 },
            { lat: 45.41, lon: -75.71 },
          ],
        },
      ],
    };

    const result = overpassToGeoJSON(data, 100);

    expect(result.features).toHaveLength(1);
    expect(result.features[0].properties).toEqual({ wayId: 4, sourceId: 100, surface: '', name: '' });
  });

  it('handles empty elements array', () => {
    const result = overpassToGeoJSON({ elements: [] }, 1);

    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toEqual([]);
  });

  it('preserves OSM surface tag from way tags', () => {
    const data = {
      elements: [
        {
          type: 'way',
          id: 111,
          tags: { surface: 'asphalt', highway: 'cycleway' },
          geometry: [
            { lat: 45.0, lon: -75.0 },
            { lat: 45.1, lon: -75.1 },
          ],
        },
        {
          type: 'way',
          id: 222,
          tags: { surface: 'gravel' },
          geometry: [
            { lat: 45.2, lon: -75.2 },
            { lat: 45.3, lon: -75.3 },
          ],
        },
      ],
    };

    const result = overpassToGeoJSON(data, 99);

    expect(result.features[0].properties!.surface).toBe('asphalt');
    expect(result.features[1].properties!.surface).toBe('gravel');
  });

  it('works with string sourceId (slug-based entries)', () => {
    const data = {
      elements: [
        {
          type: 'way',
          id: 555,
          geometry: [
            { lat: 45.0, lon: -75.0 },
            { lat: 45.1, lon: -75.1 },
          ],
        },
      ],
    };

    const result = overpassToGeoJSON(data, 'ottawa-river-pathway');

    expect(result.features[0].properties).toEqual({
      wayId: 555,
      sourceId: 'ottawa-river-pathway',
      surface: '',
      name: '',
    });
  });
});

describe('anchorBbox', () => {
  it('computes south,west,north,east with 0.005 padding from [lng, lat] anchors', () => {
    // Two anchor points: [lng, lat] format
    const anchors: Array<[number, number]> = [
      [-75.7, 45.4],  // west, south
      [-75.6, 45.5],  // east, north
    ];

    const result = anchorBbox(anchors);
    const [south, west, north, east] = result.split(',').map(Number);

    // south = min(lats) - 0.005 = 45.4 - 0.005 ~ 45.395
    // west  = min(lngs) - 0.005 = -75.7 - 0.005 = -75.705
    // north = max(lats) + 0.005 = 45.5 + 0.005 = 45.505
    // east  = max(lngs) + 0.005 = -75.6 + 0.005 = -75.595
    expect(south).toBeCloseTo(45.395, 10);
    expect(west).toBeCloseTo(-75.705, 10);
    expect(north).toBeCloseTo(45.505, 10);
    expect(east).toBeCloseTo(-75.595, 10);
  });

  it('single anchor point works', () => {
    const anchors: Array<[number, number]> = [[-75.7, 45.4]];

    const result = anchorBbox(anchors);
    const [south, west, north, east] = result.split(',').map(Number);

    // With a single point, min and max are the same
    expect(south).toBeCloseTo(45.395, 10);
    expect(west).toBeCloseTo(-75.705, 10);
    expect(north).toBeCloseTo(45.405, 10);
    expect(east).toBeCloseTo(-75.695, 10);
  });

  it('multiple anchor points compute correct min/max', () => {
    const anchors: Array<[number, number]> = [
      [-75.8, 45.3],   // westernmost, southernmost
      [-75.6, 45.5],   // easternmost, northernmost
      [-75.7, 45.4],   // middle point
    ];

    const result = anchorBbox(anchors);
    const [south, west, north, east] = result.split(',').map(Number);

    // south = 45.3 - 0.005 = 45.295
    // west  = -75.8 - 0.005 = -75.805
    // north = 45.5 + 0.005 = 45.505
    // east  = -75.6 + 0.005 = -75.595
    expect(south).toBeCloseTo(45.295, 10);
    expect(west).toBeCloseTo(-75.805, 10);
    expect(north).toBeCloseTo(45.505, 10);
    expect(east).toBeCloseTo(-75.595, 10);
  });
});

describe('buildNameQuery', () => {
  it('includes highway filter to exclude park boundary ways', () => {
    const query = buildNameQuery(['Beauclaire Park'], '45.3,-75.9,45.4,-75.8');
    // Must filter by highway tag — without this, leisure=park ways match
    expect(query).toContain('["highway"~"cycleway|path|footway|track|service|residential|tertiary|secondary|primary"]');
    // Must still include the name filter
    expect(query).toContain('["name"="Beauclaire Park"]');
  });

  it('escapes double quotes in names', () => {
    const query = buildNameQuery(['Trail "A"'], '45.3,-75.9,45.4,-75.8');
    expect(query).toContain('Trail \\"A\\"');
  });

  it('handles multiple osm_names', () => {
    const query = buildNameQuery(['Park Trail', 'Sentier du Parc'], '45.3,-75.9,45.4,-75.8');
    expect(query).toContain('["name"="Park Trail"]');
    expect(query).toContain('["name"="Sentier du Parc"]');
    // Both should have the highway filter
    const matches = query.match(/\["highway"/g);
    expect(matches).toHaveLength(2);
  });
});

describe('cleanupOrphanedCacheFiles', () => {
  function mkCache(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'cache-cleanup-'));
  }

  function touch(dir: string, file: string, content = '{}') {
    fs.writeFileSync(path.join(dir, file), content);
  }

  it('removes .geojson files that are not in the active set', () => {
    const dir = mkCache();
    try {
      touch(dir, 'ways-alpha.geojson');
      touch(dir, 'ways-beta.geojson');
      touch(dir, 'name-stale.geojson');   // orphan — not in active set
      touch(dir, '7234399.geojson');       // orphan — relation file from a removed entry
      touch(dir, 'manifest.json');         // must not be touched

      const result = cleanupOrphanedCacheFiles(dir, new Set([
        'ways-alpha.geojson',
        'ways-beta.geojson',
      ]));

      const remaining = fs.readdirSync(dir).sort();
      expect(remaining).toEqual([
        'manifest.json',
        'ways-alpha.geojson',
        'ways-beta.geojson',
      ]);
      expect(new Set(result.removed)).toEqual(new Set([
        'name-stale.geojson',
        '7234399.geojson',
      ]));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('also removes the .geojson.hash sidecar when removing a stale .geojson', () => {
    const dir = mkCache();
    try {
      touch(dir, 'ways-alpha.geojson');
      touch(dir, 'ways-alpha.geojson.hash', 'abc123');
      touch(dir, 'name-stale.geojson');
      touch(dir, 'name-stale.geojson.hash', 'def456');

      cleanupOrphanedCacheFiles(dir, new Set(['ways-alpha.geojson']));

      expect(fs.existsSync(path.join(dir, 'name-stale.geojson'))).toBe(false);
      expect(fs.existsSync(path.join(dir, 'name-stale.geojson.hash'))).toBe(false);
      expect(fs.existsSync(path.join(dir, 'ways-alpha.geojson'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'ways-alpha.geojson.hash'))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves non-geojson files (manifest.json, README) alone', () => {
    const dir = mkCache();
    try {
      touch(dir, 'manifest.json', '{"files": []}');
      touch(dir, 'README.md', 'hello');
      touch(dir, 'name-orphan.geojson');

      cleanupOrphanedCacheFiles(dir, new Set());

      expect(fs.existsSync(path.join(dir, 'manifest.json'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'README.md'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'name-orphan.geojson'))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is a no-op for an empty directory', () => {
    const dir = mkCache();
    try {
      const result = cleanupOrphanedCacheFiles(dir, new Set(['ways-alpha.geojson']));
      expect(result.removed).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('verifyGeometryMatchesAnchors', () => {
  function line(coords: [number, number][]): Feature<LineString> {
    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: coords },
    };
  }

  it('passes when the entry has no anchors (nothing to compare against)', () => {
    const result = verifyGeometryMatchesAnchors(
      { slug: 'x', name: 'X' },
      [line([[-75.7, 45.4], [-75.6, 45.5]])],
    );
    expect(result.ok).toBe(true);
  });

  it('passes when there are no features (empty fetch result)', () => {
    const result = verifyGeometryMatchesAnchors(
      { slug: 'x', name: 'X', anchors: [[-75.7, 45.4], [-75.6, 45.5]] as Array<[number, number]> },
      [],
    );
    expect(result.ok).toBe(true);
  });

  it('passes when the geometry centroid lies inside the anchor bbox', () => {
    const result = verifyGeometryMatchesAnchors(
      { slug: 'x', name: 'X', anchors: [[-75.7, 45.4], [-75.6, 45.5]] as Array<[number, number]> },
      [line([[-75.65, 45.44], [-75.64, 45.46]])],
    );
    expect(result.ok).toBe(true);
  });

  it('passes for long-distance trails whose bbox spans the whole route', () => {
    // 200km trail from Ottawa to Kingston — anchors at the endpoints, centroid in the middle.
    const result = verifyGeometryMatchesAnchors(
      { slug: 'long-trail', name: 'Long Trail', anchors: [[-75.7, 45.4], [-76.5, 44.2]] as Array<[number, number]> },
      [line([[-76.1, 44.8], [-76.0, 44.85]])],
    );
    expect(result.ok).toBe(true);
  });

  it('passes when the centroid is within the threshold distance of the bbox', () => {
    // bbox is a tight square at [-75.7, 45.4] -> [-75.6, 45.5]; centroid just outside by ~2km.
    const result = verifyGeometryMatchesAnchors(
      { slug: 'x', name: 'X', anchors: [[-75.7, 45.4], [-75.6, 45.5]] as Array<[number, number]> },
      [line([[-75.55, 45.52]])],
      10,
    );
    expect(result.ok).toBe(true);
  });

  it('fails when the centroid is far outside the anchor bbox (trail-1-1 poisoned shape)', () => {
    // Actual trail-1-1 numbers: anchors around [45.49, -76.08], poisoned centroid around [45.33, -75.87] (~18km away).
    const result = verifyGeometryMatchesAnchors(
      { slug: 'trail-1-1', name: 'Trail 1', anchors: [[-76.0868, 45.4918], [-76.0788, 45.4924]] as Array<[number, number]> },
      [line([[-75.87, 45.33], [-75.86, 45.34]])],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.distanceKm).toBeGreaterThan(10);
    }
  });

  it('reports the centroid and distance when it fails', () => {
    const result = verifyGeometryMatchesAnchors(
      { slug: 'x', name: 'X', anchors: [[-75.7, 45.4]] as Array<[number, number]> },
      [line([[-70, 50]])],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.centroid).toBeDefined();
      expect(result.distanceKm).toBeGreaterThan(100);
    }
  });

  it('handles the {lat, lng} object form of anchors (not just tuples)', () => {
    const result = verifyGeometryMatchesAnchors(
      { slug: 'x', name: 'X', anchors: [{ lat: 45.4, lng: -75.7 }, { lat: 45.5, lng: -75.6 }] },
      [line([[-75.65, 45.44]])],
    );
    expect(result.ok).toBe(true);
  });
});
