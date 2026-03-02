import { describe, it, expect } from 'vitest';
import {
  surfaceScore,
  estimatedHours,
  difficultyScore,
  difficultyLabel,
} from '../src/lib/difficulty';

describe('surfaceScore', () => {
  it('returns 0 for bike path', () => {
    expect(surfaceScore(['bike path', 'scenic'])).toBe(0);
  });
  it('returns 0.3 for gravel (nature, away from cars)', () => {
    expect(surfaceScore(['gravel'])).toBe(0.3);
  });
  it('returns 1.0 for single track', () => {
    expect(surfaceScore(['single track'])).toBe(1.0);
  });
  it('returns 0.8 for road (next to cars)', () => {
    expect(surfaceScore(['road'])).toBe(0.8);
  });
  it('returns 0.3 for untagged routes', () => {
    expect(surfaceScore(['scenic'])).toBe(0.3);
  });
});

describe('estimatedHours', () => {
  it('estimates flat bike path ride', () => {
    // 20 km at 20 km/h = 1h, no climbing
    expect(estimatedHours(20, 0, 0)).toBeCloseTo(1.0, 1);
  });
  it('adds time for climbing', () => {
    // 20 km + 200m gain = 1h + 0.33h = 1.33h
    expect(estimatedHours(20, 200, 0)).toBeCloseTo(1.33, 1);
  });
  it('uses slower base speed for rough surface', () => {
    // 20 km at 16 km/h = 1.25h
    expect(estimatedHours(20, 0, 0.7)).toBeCloseTo(1.25, 1);
  });
});

describe('difficultyScore', () => {
  it('scores easy bike path ride low', () => {
    const score = difficultyScore({
      distanceKm: 13, elevationGainPerKm: 7, maxGradientPct: 5,
      estimatedHours: 0.8, surfaceScore: 0, tags: ['easy', 'family friendly', 'bike path'],
    });
    expect(score).toBeLessThan(10);
  });

  it('scores hard mountain route high', () => {
    const score = difficultyScore({
      distanceKm: 63, elevationGainPerKm: 18.5, maxGradientPct: 17,
      estimatedHours: 5.1, surfaceScore: 0.3, tags: ['hard', 'scenic'],
    });
    expect(score).toBeGreaterThan(30);
  });

  it('never returns negative', () => {
    const score = difficultyScore({
      distanceKm: 5, elevationGainPerKm: 0, maxGradientPct: 0,
      estimatedHours: 0.3, surfaceScore: 0, tags: ['easy', 'family friendly', 'chill'],
    });
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

// Route ranking assertions from curator knowledge.
// These encode the expected relative ordering of real Ottawa routes
// to prevent regressions when tuning the formula.
describe('route ranking', () => {
  // Helper: compute score from route-level data (same as build-time logic)
  function routeScore(opts: {
    distanceKm: number; elevationGainPerKm: number;
    maxGradientPct: number; tags: string[];
  }) {
    const surface = surfaceScore(opts.tags);
    const totalGainM = opts.elevationGainPerKm * opts.distanceKm;
    const hours = estimatedHours(opts.distanceKm, totalGainM, surface);
    return difficultyScore({
      distanceKm: opts.distanceKm, elevationGainPerKm: opts.elevationGainPerKm,
      maxGradientPct: opts.maxGradientPct, estimatedHours: hours,
      surfaceScore: surface, tags: opts.tags,
    });
  }

  // Real route profiles (from content data)
  const routes = {
    easyLoop: routeScore({
      distanceKm: 13, elevationGainPerKm: 6.92, maxGradientPct: 5.6,
      tags: ['family friendly', 'easy', 'chill', 'bike path', 'snacks'],
    }),
    britannia: routeScore({
      distanceKm: 30.7, elevationGainPerKm: 4.72, maxGradientPct: 3.0,
      tags: ['scenic', 'snacks', 'bike path', 'flat', 'family friendly'],
    }),
    aylmer: routeScore({
      distanceKm: 34.3, elevationGainPerKm: 8.44, maxGradientPct: 7.8,
      tags: ['scenic', 'flat', 'poutine', 'bike path', 'beach'],
    }),
    wakefield: routeScore({
      distanceKm: 45.8, elevationGainPerKm: 13.23, maxGradientPct: 8.7,
      tags: ['scenic', 'chill', 'gravel', 'long ride'],
    }),
    carp: routeScore({
      distanceKm: 67.7, elevationGainPerKm: 5.29, maxGradientPct: 5.2,
      tags: ['road'],
    }),
    richmondManotick: routeScore({
      distanceKm: 92, elevationGainPerKm: 3.75, maxGradientPct: 5.5,
      tags: ['road'],
    }),
    epicBuckingham: routeScore({
      distanceKm: 93.4, elevationGainPerKm: 8.59, maxGradientPct: 14.6,
      tags: ['hard', 'long ride', 'elevation', 'fast'],
    }),
    gatineauMeechLake: routeScore({
      distanceKm: 63.3, elevationGainPerKm: 18.34, maxGradientPct: 17.0,
      tags: ['hard', 'scenic', 'beach'],
    }),
    lakeLeamy: routeScore({
      distanceKm: 24.3, elevationGainPerKm: 6.01, maxGradientPct: 3.3,
      tags: ['bike path', 'beach', 'snacks', 'chill'],
    }),
    bigLoop: routeScore({
      distanceKm: 31.6, elevationGainPerKm: 5.17, maxGradientPct: 5.2,
      tags: ['chill', 'bike path', 'snacks'],
    }),
    vincentMassey: routeScore({
      distanceKm: 39.6, elevationGainPerKm: 4.21, maxGradientPct: 6.2,
      tags: ['easy', 'chill', 'bike path', 'family friendly'],
    }),
    shirleysBay: routeScore({
      distanceKm: 52.4, elevationGainPerKm: 9.88, maxGradientPct: 7.0,
      tags: ['gravel'],
    }),
    plaisance: routeScore({
      distanceKm: 70.9, elevationGainPerKm: 4.19, maxGradientPct: 5.8,
      tags: ['bikepacking', 'camping', 'road'],
    }),
  };

  it('aylmer is much easier than richmond-manotick', () => {
    expect(routes.aylmer).toBeLessThan(routes.richmondManotick);
  });

  it('wakefield is easier than carp', () => {
    expect(routes.wakefield).toBeLessThan(routes.carp);
  });

  it('epic buckingham is harder than gatineau meech lake', () => {
    expect(routes.epicBuckingham).toBeGreaterThan(routes.gatineauMeechLake);
  });

  it('easy loop is easier than britannia', () => {
    expect(routes.easyLoop).toBeLessThan(routes.britannia);
  });

  it('lake leamy is easier than the big loop around ottawa', () => {
    expect(routes.lakeLeamy).toBeLessThan(routes.bigLoop);
  });

  it('lake leamy is easier than britannia', () => {
    expect(routes.lakeLeamy).toBeLessThan(routes.britannia);
  });

  it('lake leamy is easier than vincent massey', () => {
    expect(routes.lakeLeamy).toBeLessThan(routes.vincentMassey);
  });

  it('shirleys bay is easier than ottawa to plaisance', () => {
    expect(routes.shirleysBay).toBeLessThan(routes.plaisance);
  });

  // General ordering: easy rides → half-day → daylong easy → daylong hard
  it('follows easy → half-day → daylong → daylong hard ordering', () => {
    expect(routes.easyLoop).toBeLessThan(routes.aylmer);       // easy < half-day
    expect(routes.aylmer).toBeLessThan(routes.richmondManotick); // half-day < daylong
    expect(routes.richmondManotick).toBeLessThan(routes.epicBuckingham); // daylong < daylong hard
  });
});

describe('difficultyLabel', () => {
  it('returns easiest label for bottom quantile', () => {
    const allScores = [5, 10, 15, 20, 25, 30, 35, 40];
    expect(difficultyLabel(5, allScores)).toBe('easiest');
  });
  it('returns hardest label for top quantile', () => {
    const allScores = [5, 10, 15, 20, 25, 30, 35, 40];
    expect(difficultyLabel(40, allScores)).toBe('hardest');
  });
  it('returns average label for middle', () => {
    const allScores = [5, 10, 15, 20, 25, 30, 35, 40];
    expect(difficultyLabel(20, allScores)).toBe('average');
  });
});
