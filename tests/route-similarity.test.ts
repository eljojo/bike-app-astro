import { describe, it, expect } from 'vitest';
import { lowresPoints, similarity, findSimilarRoutes } from '../src/lib/route-similarity';

describe('lowresPoints', () => {
  it('rounds points to precision 4', () => {
    const points: [number, number][] = [
      [45.123456789, -75.987654321],
      [45.123499999, -75.987600001],
    ];
    const result = lowresPoints(points);
    expect(result).toEqual([
      [45.1235, -75.9877],
      [45.1235, -75.9876],
    ]);
  });
});

describe('similarity', () => {
  it('returns 100 for identical routes', () => {
    const points: [number, number][] = [[45.1, -75.2], [45.2, -75.3], [45.3, -75.4]];
    expect(similarity(points, points)).toBe(100);
  });

  it('returns 0 for completely different routes', () => {
    const a: [number, number][] = [[45.1, -75.2], [45.2, -75.3]];
    const b: [number, number][] = [[50.0, -80.0], [51.0, -81.0]];
    expect(similarity(a, b)).toBe(0);
  });

  it('returns partial overlap for similar routes', () => {
    const a: [number, number][] = [[45.1, -75.2], [45.2, -75.3], [45.3, -75.4]];
    const b: [number, number][] = [[45.1, -75.2], [45.2, -75.3], [45.9, -75.9]];
    const score = similarity(a, b);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
  });
});

describe('findSimilarRoutes', () => {
  it('returns top N similar routes sorted by score', () => {
    const matrix: Record<string, Record<string, number>> = {
      a: { b: 80, c: 30, d: 50 },
      b: { a: 80, c: 10, d: 20 },
      c: { a: 30, b: 10, d: 90 },
      d: { a: 50, b: 20, c: 90 },
    };
    const result = findSimilarRoutes('a', matrix, 2);
    expect(result).toEqual([
      { id: 'b', score: 80 },
      { id: 'd', score: 50 },
    ]);
  });

  it('excludes routes below threshold', () => {
    const matrix: Record<string, Record<string, number>> = {
      a: { b: 5, c: 3 },
    };
    const result = findSimilarRoutes('a', matrix, 3, 10);
    expect(result).toEqual([]);
  });
});
