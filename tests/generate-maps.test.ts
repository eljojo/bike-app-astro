import { describe, it, expect } from 'vitest';
import { mergeAdjacentSegments } from '../src/lib/geo/merge-segments';
import { buildStaticMapUrl } from '../src/lib/maps/map-paths';
import polylineCodec from '@mapbox/polyline';

describe('mergeAdjacentSegments', () => {
  it('returns empty array for empty input', () => {
    expect(mergeAdjacentSegments([], 0.1)).toEqual([]);
  });

  it('returns a single segment unchanged', () => {
    const seg: [number, number][][] = [[[45.0, -75.0], [45.01, -75.01]]];
    const result = mergeAdjacentSegments(seg, 0.1);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual([[45.0, -75.0], [45.01, -75.01]]);
  });

  it('merges two adjacent segments whose endpoints are within maxGapKm', () => {
    // Two segments ~50m apart (well within 0.1 km threshold)
    const seg1: [number, number][] = [[45.0, -75.0], [45.001, -75.001]];
    const seg2: [number, number][] = [[45.0014, -75.0014], [45.002, -75.002]];
    const result = mergeAdjacentSegments([seg1, seg2], 0.1);
    expect(result).toHaveLength(1);
    // Chain should contain all points from both segments
    expect(result[0]).toHaveLength(4);
    expect(result[0][0]).toEqual([45.0, -75.0]);
    expect(result[0][3]).toEqual([45.002, -75.002]);
  });

  it('keeps disconnected segments separate', () => {
    // Two segments 10+ km apart
    const seg1: [number, number][] = [[45.0, -75.0], [45.01, -75.01]];
    const seg2: [number, number][] = [[46.0, -76.0], [46.01, -76.01]];
    const result = mergeAdjacentSegments([seg1, seg2], 0.1);
    expect(result).toHaveLength(2);
  });

  it('reverses a segment when its end is closer than its start', () => {
    // seg1 ends at 45.001, seg2 ends at 45.0014 (close) but starts at 45.003 (far)
    const seg1: [number, number][] = [[45.0, -75.0], [45.001, -75.001]];
    const seg2: [number, number][] = [[45.003, -75.003], [45.0014, -75.0014]];
    const result = mergeAdjacentSegments([seg1, seg2], 0.1);
    expect(result).toHaveLength(1);
    // seg2 should be reversed: its end [45.0014] was close to seg1's end [45.001]
    // so the chain goes: seg1[0], seg1[1], seg2[end], seg2[start]
    expect(result[0][2]).toEqual([45.0014, -75.0014]); // was seg2's end, now third
    expect(result[0][3]).toEqual([45.003, -75.003]);    // was seg2's start, now last
  });

  it('merges three segments into one chain in correct order', () => {
    // Three segments arranged: seg1 → seg2 → seg3
    const seg1: [number, number][] = [[45.0, -75.0], [45.001, -75.001]];
    const seg2: [number, number][] = [[45.0014, -75.0014], [45.002, -75.002]];
    const seg3: [number, number][] = [[45.0024, -75.0024], [45.003, -75.003]];
    // Feed out of order to test greedy merging
    const result = mergeAdjacentSegments([seg1, seg3, seg2], 0.1);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(6);
    // Should start at seg1's start and end at seg3's end
    expect(result[0][0]).toEqual([45.0, -75.0]);
    expect(result[0][5]).toEqual([45.003, -75.003]);
  });
});

describe('bike path map URL construction', () => {
  // Simulates the flow for constructing bike path map URLs:
  // GeoJSON coords → [lat, lng] segments → merge → encode → buildStaticMapUrl
  //
  // Points must be within 150m of each other (gapKm: 0.15) to stay in the
  // same path segment. ~0.001° lat ≈ 111m, so 0.001° steps are safe.

  /** Build a dense line of points between two coordinates (~100m apart each). */
  function denseLine(start: [number, number], end: [number, number], steps: number): number[][] {
    const points: number[][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      points.push([
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
      ]);
    }
    return points; // [lng, lat] — GeoJSON order
  }

  function buildBikePathUrl(geoJsonCoords: number[][][]): string {
    const segments: [number, number][][] = geoJsonCoords.map(
      line => line.map(c => [c[1], c[0]] as [number, number]),
    );
    const merged = mergeAdjacentSegments(segments, 0.1);
    const allPoints = merged.flatMap(seg => seg);
    const encoded = polylineCodec.encode(allPoints);
    return buildStaticMapUrl(encoded, 'TEST_KEY', 'en', {
      size: '800x400',
      markers: false,
      gapKm: 0.15,
    });
  }

  it('produces a valid Google Maps Static API URL', () => {
    const coords = [denseLine([-75.69, 45.42], [-75.685, 45.415], 10)];
    const url = buildBikePathUrl(coords);
    expect(url).toContain('https://maps.googleapis.com/maps/api/staticmap');
    expect(url).toContain('key=TEST_KEY');
    expect(url).toContain('size=800x400');
    expect(url).toContain('language=en');
    expect(url).toContain('&path=enc:');
  });

  it('does not include start/end markers', () => {
    const coords = [denseLine([-75.69, 45.42], [-75.685, 45.415], 10)];
    const url = buildBikePathUrl(coords);
    expect(url).not.toContain('markers=');
  });

  it('encodes coordinates in correct lat,lng order', () => {
    // GeoJSON is [lng, lat], but polyline encoding expects [lat, lng]
    const coords = [denseLine([-75.69, 45.42], [-75.685, 45.415], 10)];
    const url = buildBikePathUrl(coords);

    // Extract and decode the polyline from the URL
    const match = url.match(/&path=enc:([^&]+)/);
    expect(match).not.toBeNull();
    const decoded = polylineCodec.decode(match![1]);
    // First point should be lat=45.42, lng=-75.69 (GeoJSON→latLng conversion)
    expect(decoded[0][0]).toBeCloseTo(45.42, 1);
    expect(decoded[0][1]).toBeCloseTo(-75.69, 1);
  });

  it('merges adjacent segments before encoding', () => {
    // Two dense segments ~50m apart — should merge into one chain → one &path=
    const seg1 = denseLine([-75.69, 45.42], [-75.6875, 45.4175], 5);
    const seg2 = denseLine([-75.6871, 45.4171], [-75.685, 45.415], 5);
    const url = buildBikePathUrl([seg1, seg2]);

    const pathCount = (url.match(/&path=enc:/g) || []).length;
    expect(pathCount).toBe(1);
  });

  it('splits genuinely disconnected segments into separate paths', () => {
    // Two dense segments 10+ km apart — gap > 0.15km threshold
    const seg1 = denseLine([-75.69, 45.42], [-75.685, 45.415], 5);
    const seg2 = denseLine([-75.50, 45.30], [-75.495, 45.295], 5);
    const url = buildBikePathUrl([seg1, seg2]);

    // mergeAdjacentSegments can't merge (>0.1km gap), so two chains.
    // buildStaticMapUrl's splitAtGaps detects the large gap → two &path= params
    const pathCount = (url.match(/&path=enc:/g) || []).length;
    expect(pathCount).toBe(2);
  });
});
