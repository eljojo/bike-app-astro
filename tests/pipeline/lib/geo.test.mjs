import { describe, it, expect } from 'vitest';
import {
  nearestPointOnPolyline,
  corridorWidth,
  haversineM,
  allCoords,
  endpoints,
  lineLength,
  minEndpointDistance,
  formatDistance,
  segmentIntersection,
  findJunctionCandidates,
} from '../../../scripts/pipeline/lib/geo.mjs';

// Helper: build a measured polyline structure expected by findJunctionCandidates
function makePoly(coords) {
  const cumDist = [0];
  for (let i = 1; i < coords.length; i++) {
    cumDist.push(cumDist[i - 1] + haversineM(coords[i - 1], coords[i]));
  }
  return { coords, cumDist, totalLength: cumDist[cumDist.length - 1] };
}

describe('nearestPointOnPolyline', () => {
  it('projects a point onto a straight horizontal line', () => {
    const polyline = [[-70.66, -33.42], [-70.64, -33.42], [-70.62, -33.42]];
    const result = nearestPointOnPolyline([-70.64, -33.43], polyline);
    expect(result.scalar).toBeGreaterThan(1500);
    expect(result.scalar).toBeLessThan(2000);
    expect(result.coord[0]).toBeCloseTo(-70.64, 3);
    expect(result.coord[1]).toBeCloseTo(-33.42, 3);
  });

  it('clamps to start when point is before the line', () => {
    const polyline = [[-70.64, -33.42], [-70.62, -33.42]];
    const result = nearestPointOnPolyline([-70.66, -33.42], polyline);
    expect(result.scalar).toBe(0);
  });

  it('clamps to end when point is past the line', () => {
    const polyline = [[-70.64, -33.42], [-70.62, -33.42]];
    const result = nearestPointOnPolyline([-70.60, -33.42], polyline);
    expect(result.scalar).toBeCloseTo(result.totalLength, 1);
  });

  it('works on a north-south line', () => {
    const polyline = [[-70.60, -33.45], [-70.60, -33.43], [-70.60, -33.41]];
    const result = nearestPointOnPolyline([-70.61, -33.43], polyline);
    expect(result.scalar).toBeGreaterThan(1500);
    expect(result.scalar).toBeLessThan(3000);
  });

  it('returns totalLength field', () => {
    const polyline = [[-70.64, -33.42], [-70.62, -33.42]];
    const result = nearestPointOnPolyline([-70.63, -33.42], polyline);
    expect(result.totalLength).toBeGreaterThan(1500);
    expect(result.totalLength).toBeLessThan(2000);
  });
});

describe('corridorWidth', () => {
  it('returns 0 for a single point', () => {
    expect(corridorWidth([[-75.9, 45.3]])).toBe(0);
  });

  it('returns 0 for collinear points (pure line)', () => {
    const points = [[-75.9, 45.30], [-75.9, 45.31], [-75.9, 45.32]];
    expect(corridorWidth(points)).toBeLessThan(1);
  });

  it('returns small width for a narrow corridor', () => {
    const points = [
      [-75.82, 45.29], [-75.82, 45.30], [-75.82, 45.31],
      [-75.8205, 45.295], [-75.8195, 45.305],
    ];
    const w = corridorWidth(points);
    expect(w).toBeLessThan(500);
    expect(w).toBeGreaterThan(50);
  });

  it('returns large width for a spread-out cluster', () => {
    const points = [
      [-75.82, 45.29], [-75.82, 45.31],
      [-75.80, 45.29], [-75.80, 45.31],
    ];
    const w = corridorWidth(points);
    expect(w).toBeGreaterThan(1500);
  });
});

describe('haversineM', () => {
  it('returns 0 for identical points', () => {
    expect(haversineM([-75.70, 45.42], [-75.70, 45.42])).toBe(0);
  });

  it('returns ~780 m for 0.01° longitude near Ottawa (45.42°N)', () => {
    // cos(45.42°) ≈ 0.7022, so 0.01° ≈ 780 m
    const d = haversineM([-75.70, 45.42], [-75.69, 45.42]);
    expect(d).toBeCloseTo(780.48, 0);
  });

  it('returns ~111 195 m for 1° latitude at the equator', () => {
    const d = haversineM([0, 0], [0, 1]);
    expect(d).toBeCloseTo(111194.93, 0);
  });

  it('returns ~166 347 m for Ottawa → Montreal', () => {
    // Ottawa: -75.6972, 45.4215  Montreal: -73.5673, 45.5017
    const d = haversineM([-75.6972, 45.4215], [-73.5673, 45.5017]);
    expect(d).toBeCloseTo(166346.67, 0);
  });

  it('is symmetric', () => {
    const a = [-75.70, 45.42];
    const b = [-73.57, 45.50];
    expect(haversineM(a, b)).toBeCloseTo(haversineM(b, a), 6);
  });
});

describe('allCoords', () => {
  it('returns 2D coords for a LineString, stripping Z', () => {
    const geom = {
      type: 'LineString',
      coordinates: [[-75.70, 45.42, 100], [-75.69, 45.43, 200]],
    };
    expect(allCoords(geom)).toEqual([[-75.70, 45.42], [-75.69, 45.43]]);
  });

  it('flattens a MultiLineString into a single array', () => {
    const geom = {
      type: 'MultiLineString',
      coordinates: [
        [[-75.70, 45.42], [-75.69, 45.43]],
        [[-75.68, 45.44], [-75.67, 45.45]],
      ],
    };
    expect(allCoords(geom)).toEqual([
      [-75.70, 45.42],
      [-75.69, 45.43],
      [-75.68, 45.44],
      [-75.67, 45.45],
    ]);
  });

  it('preserves coordinate count for LineString', () => {
    const geom = {
      type: 'LineString',
      coordinates: [[-75.70, 45.42], [-75.69, 45.43], [-75.68, 45.44]],
    };
    expect(allCoords(geom)).toHaveLength(3);
  });
});

describe('endpoints', () => {
  it('returns start and end of a LineString', () => {
    const geom = {
      type: 'LineString',
      coordinates: [[-75.70, 45.42, 100], [-75.69, 45.43], [-75.68, 45.44]],
    };
    const { start, end } = endpoints(geom);
    expect(start).toEqual([-75.70, 45.42]);
    expect(end).toEqual([-75.68, 45.44]);
  });

  it('returns first coord of first line and last coord of last line for MultiLineString', () => {
    const geom = {
      type: 'MultiLineString',
      coordinates: [
        [[-75.70, 45.42], [-75.69, 45.43]],
        [[-75.68, 45.44], [-75.67, 45.45]],
      ],
    };
    const { start, end } = endpoints(geom);
    expect(start).toEqual([-75.70, 45.42]);
    expect(end).toEqual([-75.67, 45.45]);
  });

  it('strips Z from LineString endpoints', () => {
    const geom = {
      type: 'LineString',
      coordinates: [[-75.70, 45.42, 50], [-75.69, 45.43, 60]],
    };
    const { start, end } = endpoints(geom);
    expect(start).toHaveLength(2);
    expect(end).toHaveLength(2);
  });
});

describe('lineLength', () => {
  it('returns haversine length for a 2-point LineString', () => {
    const geom = {
      type: 'LineString',
      coordinates: [[-75.70, 45.42], [-75.69, 45.42]],
    };
    // Matches haversineM directly
    expect(lineLength(geom)).toBeCloseTo(780.48, 0);
  });

  it('sums all segment lengths for a multi-point LineString', () => {
    // Two equal EW segments of ~780 m each
    const geom = {
      type: 'LineString',
      coordinates: [[-75.70, 45.42], [-75.69, 45.42], [-75.68, 45.42]],
    };
    expect(lineLength(geom)).toBeCloseTo(780.48 * 2, -1);
  });

  it('sums all lines of a MultiLineString', () => {
    const geom = {
      type: 'MultiLineString',
      coordinates: [
        [[-75.70, 45.42], [-75.69, 45.42]],
        [[-75.68, 45.43], [-75.67, 45.43]],
      ],
    };
    // Each segment ~780 m; total ~1560 m
    expect(lineLength(geom)).toBeCloseTo(1560.83, 0);
  });

  it('returns 0 for a degenerate single-point LineString', () => {
    const geom = { type: 'LineString', coordinates: [[-75.70, 45.42]] };
    expect(lineLength(geom)).toBe(0);
  });
});

describe('minEndpointDistance', () => {
  it('returns 0 when two features share an endpoint', () => {
    const a = { start: [-75.70, 45.42], end: [-75.69, 45.42] };
    const b = { start: [-75.69, 45.42], end: [-75.68, 45.42] };
    const result = minEndpointDistance(a, b);
    expect(result.distance).toBe(0);
    expect(result.fromEnd).toBe('end');
    expect(result.toEnd).toBe('start');
  });

  it('returns the smallest pairwise distance and correct endpoint labels', () => {
    // a.end = -75.69 is ~1561 m from b.start = -75.67
    const a = { start: [-75.70, 45.42], end: [-75.69, 45.42] };
    const b = { start: [-75.67, 45.42], end: [-75.66, 45.42] };
    const result = minEndpointDistance(a, b);
    expect(result.distance).toBeCloseTo(1560.96, 0);
    expect(result.fromEnd).toBe('end');
    expect(result.toEnd).toBe('start');
  });

  it('is not fooled by a closer start-to-start pairing', () => {
    // a.start = -75.70 is ~780 m from b.start = -75.69
    // a.end = -75.71 is farther from both
    const a = { start: [-75.70, 45.42], end: [-75.71, 45.42] };
    const b = { start: [-75.69, 45.42], end: [-75.68, 45.42] };
    const result = minEndpointDistance(a, b);
    expect(result.distance).toBeCloseTo(780.48, 0);
    expect(result.fromEnd).toBe('start');
    expect(result.toEnd).toBe('start');
  });
});

describe('formatDistance', () => {
  it('formats sub-kilometre distances as "N m" (rounded)', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(500)).toBe('500 m');
    expect(formatDistance(999)).toBe('999 m');
  });

  it('formats exactly 1000 m as "1.0 km"', () => {
    expect(formatDistance(1000)).toBe('1.0 km');
  });

  it('formats kilometre distances to one decimal', () => {
    expect(formatDistance(1500)).toBe('1.5 km');
    expect(formatDistance(1234.5)).toBe('1.2 km');
  });

  it('rounds fractional metres correctly', () => {
    // 999.9 rounds to 1000 m, which should appear as "1000 m" not "1.0 km"
    // because formatDistance checks metres >= 1000 before Math.round
    expect(formatDistance(999.9)).toBe('1000 m');
  });
});

describe('segmentIntersection', () => {
  it('finds the crossing point of two diagonals at (0.5, 0.5)', () => {
    // A: (0,0)→(1,1)  B: (0,1)→(1,0)
    const result = segmentIntersection([0, 0], [1, 1], [0, 1], [1, 0]);
    expect(result).not.toBeNull();
    expect(result.t).toBeCloseTo(0.5, 10);
    expect(result.u).toBeCloseTo(0.5, 10);
    expect(result.coord[0]).toBeCloseTo(0.5, 10);
    expect(result.coord[1]).toBeCloseTo(0.5, 10);
  });

  it('finds a perpendicular crossing at (0.5, 0.5)', () => {
    // A: (0.5,0)→(0.5,1)  B: (0,0.5)→(1,0.5)
    const result = segmentIntersection([0.5, 0], [0.5, 1], [0, 0.5], [1, 0.5]);
    expect(result).not.toBeNull();
    expect(result.coord[0]).toBeCloseTo(0.5, 10);
    expect(result.coord[1]).toBeCloseTo(0.5, 10);
  });

  it('returns null for parallel horizontal segments', () => {
    // A: (0,0)→(1,0)  B: (0,1)→(1,1)
    expect(segmentIntersection([0, 0], [1, 0], [0, 1], [1, 1])).toBeNull();
  });

  it('returns null when the mathematical crossing is outside both segments', () => {
    // A: (0,0)→(0.3,0.3)  B: (0.7,0)→(1,0.3) — lines would cross if extended, but not within [0,1]
    expect(segmentIntersection([0, 0], [0.3, 0.3], [0.7, 0], [1, 0.3])).toBeNull();
  });

  it('returns intersection when segments share exactly one endpoint', () => {
    // A: (0,0)→(0.5,0.5)  B: (0.5,0.5)→(1,0)
    const result = segmentIntersection([0, 0], [0.5, 0.5], [0.5, 0.5], [1, 0]);
    expect(result).not.toBeNull();
    expect(result.coord[0]).toBeCloseTo(0.5, 10);
    expect(result.coord[1]).toBeCloseTo(0.5, 10);
  });
});

describe('findJunctionCandidates', () => {
  it('returns a cross candidate when two segments physically intersect', () => {
    // A: horizontal (0,0)→(1,0)  B: vertical (0.5,-0.5)→(0.5,0.5) — cross at (0.5,0)
    const polyA = makePoly([[0, 0], [1, 0]]);
    const polyB = makePoly([[0.5, -0.5], [0.5, 0.5]]);
    const candidates = findJunctionCandidates(polyA, polyB);
    expect(candidates[0].type).toBe('cross');
    expect(candidates[0].coord[0]).toBeCloseTo(0.5, 8);
    expect(candidates[0].coord[1]).toBeCloseTo(0, 8);
    expect(candidates[0].dist).toBe(0);
  });

  it('returns a touch candidate when an endpoint of one line is within 40 m of the other', () => {
    // Two collinear EW segments that share an endpoint exactly
    // A: (0,0)→(0.005,0)  B: (0.005,0)→(0.01,0) — A.end == B.start, dist=0 → touch
    const polyA = makePoly([[0, 0], [0.005, 0]]);
    const polyB = makePoly([[0.005, 0], [0.01, 0]]);
    const candidates = findJunctionCandidates(polyA, polyB);
    const touchCandidates = candidates.filter((c) => c.type === 'touch');
    expect(touchCandidates.length).toBeGreaterThan(0);
    expect(touchCandidates[0].dist).toBeCloseTo(0, 1);
  });

  it('sorts candidates: cross before touch before gap', () => {
    const polyA = makePoly([[0, 0], [1, 0]]);
    const polyB = makePoly([[0.5, -0.5], [0.5, 0.5]]);
    const candidates = findJunctionCandidates(polyA, polyB);
    const types = candidates.map((c) => c.type);
    const crossIdx = types.indexOf('cross');
    const gapIdx = types.lastIndexOf('gap');
    expect(crossIdx).toBeLessThan(gapIdx);
  });

  it('returns only a gap candidate when lines are far apart (> 40 m threshold)', () => {
    // Two parallel EW lines ~445 m apart (0.004° N-S near Ottawa)
    const polyA = makePoly([[-75.70, 45.42], [-75.69, 45.42]]);
    const polyB = makePoly([[-75.70, 45.424], [-75.69, 45.424]]);
    const candidates = findJunctionCandidates(polyA, polyB);
    expect(candidates.every((c) => c.type === 'gap')).toBe(true);
    // The gap distance should be ~445 m
    expect(candidates[0].dist).toBeCloseTo(444.78, 0);
  });

  it('always includes at least one candidate (the gap fallback)', () => {
    const polyA = makePoly([[-75.70, 45.42], [-75.69, 45.42]]);
    const polyB = makePoly([[-75.00, 45.42], [-74.99, 45.42]]);
    const candidates = findJunctionCandidates(polyA, polyB);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates[candidates.length - 1].type).toBe('gap');
  });
});
