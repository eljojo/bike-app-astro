import { describe, it, expect } from 'vitest';
import { difficultyRanking, routeShape, placeSummary } from '../src/lib/route-insights';

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
    expect(routeShape(points)).toBe('loop');
  });

  it('returns "out & back" when start and end are far', () => {
    const points = [
      { lat: 45.4, lon: -75.7 },
      { lat: 45.5, lon: -75.6 },
      { lat: 45.6, lon: -75.5 },
    ];
    expect(routeShape(points)).toBe('out & back');
  });

  it('returns null for empty points', () => {
    expect(routeShape([])).toBeNull();
  });
});

describe('placeSummary', () => {
  it('groups places by category and returns summary', () => {
    const places = [
      { category: 'cafe' },
      { category: 'cafe' },
      { category: 'park' },
      { category: 'beach' },
      { category: 'cafe' },
    ];
    const result = placeSummary(places);
    expect(result).toBe('passes 3 cafes, 1 park, 1 beach');
  });

  it('returns null for empty places', () => {
    expect(placeSummary([])).toBeNull();
  });

  it('uses singular for count of 1', () => {
    const result = placeSummary([{ category: 'cafe' }]);
    expect(result).toBe('passes 1 cafe');
  });
});
