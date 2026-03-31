import { describe, it, expect } from 'vitest';
import { sampleGeoJsonPoints, SAMPLE_INTERVAL } from '../src/lib/geo/geojson-sampling';

describe('sampleGeoJsonPoints', () => {
  it('samples every Nth point from a LineString', () => {
    const coords = Array.from({ length: 25 }, (_, i) => [i * 0.01, i * 0.01 + 1]);
    const geojson = {
      features: [{ geometry: { type: 'LineString', coordinates: coords } }],
    };
    const points = sampleGeoJsonPoints(geojson, 10);
    // Points at indices 0, 10, 20, plus last point (24)
    expect(points).toHaveLength(4);
    expect(points[0]).toEqual({ lat: 1, lng: 0 }); // coords[0] = [0, 1]
    expect(points[1]).toEqual({ lat: 1.1, lng: 0.1 }); // coords[10] = [0.1, 1.1]
    expect(points[2]).toEqual({ lat: 1.2, lng: 0.2 }); // coords[20] = [0.2, 1.2]
    expect(points[3]).toEqual({ lat: 1.24, lng: 0.24 }); // last = coords[24]
  });

  it('handles MultiLineString geometry', () => {
    const geojson = {
      features: [{
        geometry: {
          type: 'MultiLineString',
          coordinates: [
            [[0, 1], [0.1, 1.1]], // 2 points
            [[0.2, 1.2], [0.3, 1.3]], // 2 points
          ],
        },
      }],
    };
    const points = sampleGeoJsonPoints(geojson, 10);
    // Each line has fewer than 10 points, so each gets point[0] + last point
    // Line 1: [0] sampled, [1] is last (length 2, 2%10 !== 0) → 2 points
    // Line 2: [0] sampled, [1] is last (length 2, 2%10 !== 0) → 2 points
    expect(points).toHaveLength(4);
    expect(points[0]).toEqual({ lat: 1, lng: 0 });
    expect(points[1]).toEqual({ lat: 1.1, lng: 0.1 });
    expect(points[2]).toEqual({ lat: 1.2, lng: 0.2 });
    expect(points[3]).toEqual({ lat: 1.3, lng: 0.3 });
  });

  it('skips non-line geometry types', () => {
    const geojson = {
      features: [
        { geometry: { type: 'Point', coordinates: [0, 1] } },
        { geometry: { type: 'Polygon', coordinates: [[[0, 1], [1, 1], [1, 0], [0, 0], [0, 1]]] } },
      ],
    };
    const points = sampleGeoJsonPoints(geojson, 10);
    expect(points).toHaveLength(0);
  });

  it('handles empty features array', () => {
    expect(sampleGeoJsonPoints({ features: [] })).toHaveLength(0);
    expect(sampleGeoJsonPoints({})).toHaveLength(0);
  });

  it('does not duplicate last point when length is exactly divisible by interval', () => {
    const coords = Array.from({ length: 20 }, (_, i) => [i * 0.01, i * 0.01 + 1]);
    const geojson = {
      features: [{ geometry: { type: 'LineString', coordinates: coords } }],
    };
    const points = sampleGeoJsonPoints(geojson, 10);
    // Points at indices 0, 10 — length 20 % 10 === 0, so no last-point addition
    expect(points).toHaveLength(2);
  });

  it('exports SAMPLE_INTERVAL as 10', () => {
    expect(SAMPLE_INTERVAL).toBe(10);
  });
});
