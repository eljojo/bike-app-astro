import { describe, it, expect } from 'vitest';
import { overpassToGeoJSON, anchorBbox, buildNameQuery } from '../scripts/cache-path-geometry';

describe('overpassToGeoJSON', () => {
  it('converts Overpass way elements to GeoJSON FeatureCollection with [lon, lat] coordinates', () => {
    const data = {
      elements: [
        {
          type: 'way',
          id: 12345,
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
    expect(result.features[0].properties).toEqual({ wayId: 12345, sourceId: 99999 });

    // Second feature
    expect((result.features[1].geometry as GeoJSON.LineString).coordinates).toEqual([
      [-75.6, 45.5],
      [-75.61, 45.51],
      [-75.62, 45.52],
    ]);
    expect(result.features[1].properties).toEqual({ wayId: 67890, sourceId: 99999 });
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
    expect(result.features[0].properties).toEqual({ wayId: 4, sourceId: 100 });
  });

  it('handles empty elements array', () => {
    const result = overpassToGeoJSON({ elements: [] }, 1);

    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toEqual([]);
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
