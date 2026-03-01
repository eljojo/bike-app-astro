import { describe, it, expect } from 'vitest';
import { difficultyRanking, routeShape, placeCounts, adjustedElevationGainPerKm } from '../src/lib/route-insights';

describe('difficultyRanking', () => {
  const routes = [
    { id: 'flat', elevationGainPerKm: 2 },
    { id: 'medium', elevationGainPerKm: 8 },
    { id: 'hard', elevationGainPerKm: 15 },
  ];

  it('returns rank and total for a route', () => {
    const result = difficultyRanking('medium', routes);
    expect(result).toEqual({ rank: 2, total: 3 });
  });

  it('ranks hardest route as #1', () => {
    const result = difficultyRanking('hard', routes);
    expect(result).toEqual({ rank: 1, total: 3 });
  });

  it('returns null for unknown route', () => {
    const result = difficultyRanking('unknown', routes);
    expect(result).toBeNull();
  });
});

describe('routeShape', () => {
  it('returns "loop" when start and end are close', () => {
    const points = [
      { lat: 45.4, lon: -75.7 },
      { lat: 45.5, lon: -75.6 },
      { lat: 45.4, lon: -75.7 },
    ];
    expect(routeShape(points, 20000)).toBe('loop');
  });

  it('returns "out-and-back" when start and end are far but directness is low', () => {
    const points = [
      { lat: 45.4, lon: -75.7 },
      { lat: 45.5, lon: -75.6 },
      { lat: 45.6, lon: -75.5 },
    ];
    expect(routeShape(points, 100000)).toBe('out-and-back');
  });

  it('returns "one-way" when start/end are far and directness is high', () => {
    const points = [
      { lat: 45.4, lon: -75.7 },
      { lat: 45.45, lon: -75.65 },
      { lat: 45.5, lon: -75.6 },
    ];
    // haversine ~14km, distance 20km => ratio 0.7 > 0.4
    expect(routeShape(points, 20000)).toBe('one-way');
  });

  it('returns null for empty points', () => {
    expect(routeShape([], 0)).toBeNull();
  });
});

describe('adjustedElevationGainPerKm', () => {
  it('returns raw gain/km for loop (net elevation ~0)', () => {
    expect(adjustedElevationGainPerKm(74, 0, 20)).toBeCloseTo(3.7);
  });
  it('returns 0 for one-way descent where drop exceeds gain', () => {
    expect(adjustedElevationGainPerKm(74, -100, 19.6)).toBe(0);
  });
  it('reduces gain partially for mild descent', () => {
    expect(adjustedElevationGainPerKm(74, -30, 19.6)).toBeCloseTo(2.245, 1);
  });
  it('keeps gain unchanged for climbs (net positive)', () => {
    expect(adjustedElevationGainPerKm(200, 150, 15)).toBeCloseTo(13.33, 1);
  });
});

describe('placeCounts', () => {
  it('groups places by category sorted by count', () => {
    const places = [
      { category: 'cafe' },
      { category: 'cafe' },
      { category: 'park' },
      { category: 'beach' },
      { category: 'cafe' },
    ];
    expect(placeCounts(places)).toEqual([
      { category: 'cafe', count: 3 },
      { category: 'park', count: 1 },
      { category: 'beach', count: 1 },
    ]);
  });

  it('returns empty array for no places', () => {
    expect(placeCounts([])).toEqual([]);
  });

  it('handles single place', () => {
    expect(placeCounts([{ category: 'cafe' }])).toEqual([
      { category: 'cafe', count: 1 },
    ]);
  });
});
