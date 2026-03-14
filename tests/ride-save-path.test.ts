import { describe, it, expect } from 'vitest';
import { deriveGpxRelativePath, resolveNewRideSlug } from '../src/lib/ride-paths';
import { extractDateFromPath } from '../src/loaders/rides';

/**
 * Round-trip contract tests: the save pipeline (deriveGpxRelativePath) produces
 * paths that the rides loader (extractDateFromPath) can parse back into correct dates.
 *
 * This test exists because a bug shipped where these two functions disagreed on
 * filename format — deriveGpxRelativePath produced YYYY/MM/YYYY-MM-DD-name.gpx,
 * but extractDateFromPath expected YYYY/MM/DD-name.gpx. Each function's unit tests
 * passed in isolation, but the contract between them was broken.
 */
describe('save → load round-trip contract', () => {
  const cases = [
    {
      name: 'Strava import (full date in filename)',
      rideDate: '2026-03-09',
      gpxFilename: '2026-03-09-first-ride-of-the-year.gpx',
      expectedDate: { year: 2026, month: 3, day: 9 },
    },
    {
      name: 'GPX file upload (bare filename, no date prefix)',
      rideDate: '2026-03-09',
      gpxFilename: 'morning-ride.gpx',
      expectedDate: { year: 2026, month: 3, day: 9 },
    },
    {
      name: 'already-correct DD-name.gpx',
      rideDate: '2026-01-23',
      gpxFilename: '23-winter-ride.gpx',
      expectedDate: { year: 2026, month: 1, day: 23 },
    },
    {
      name: 'single-digit day',
      rideDate: '2025-06-03',
      gpxFilename: 'afternoon-spin.gpx',
      expectedDate: { year: 2025, month: 6, day: 3 },
    },
  ];

  for (const { name, rideDate, gpxFilename, expectedDate } of cases) {
    it(`${name}: path produced by save is loadable`, () => {
      const path = deriveGpxRelativePath(rideDate, gpxFilename);
      const parsed = extractDateFromPath(path);
      expect(parsed).not.toBeNull();
      expect(parsed).toEqual(expectedDate);
    });
  }

  it('tour ride: path produced by save is loadable', () => {
    const path = deriveGpxRelativePath('2025-09-09', '2025-09-09-amsterdam.gpx', 'euro-trip');
    const parsed = extractDateFromPath(path);
    expect(parsed).not.toBeNull();
    expect(parsed).toEqual({ year: 2025, month: 9, day: 9 });
  });
});

describe('resolveNewRideSlug', () => {
  it('includes date prefix for standalone rides', () => {
    expect(resolveNewRideSlug('morning-ride', '2026-03-15'))
      .toBe('2026-03-15-morning-ride');
  });

  it('uses name-only slug for tour rides', () => {
    expect(resolveNewRideSlug('day-1', '2026-03-15', 'euro-trip'))
      .toBe('day-1');
  });

  it('slugifies the name', () => {
    expect(resolveNewRideSlug('Morning Ride!', '2026-03-15'))
      .toBe('2026-03-15-morning-ride');
  });
});
