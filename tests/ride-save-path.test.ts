import { describe, it, expect } from 'vitest';
import { deriveGpxRelativePath, resolveNewRideSlug } from '../src/lib/ride-paths';

describe('deriveGpxRelativePath', () => {
  it('computes path from ride_date and gpx filename', () => {
    expect(deriveGpxRelativePath('2026-03-09', '09-first-ride.gpx'))
      .toBe('2026/03/09-first-ride.gpx');
  });

  it('computes path with tour_slug', () => {
    expect(deriveGpxRelativePath('2026-03-09', '09-first-ride.gpx', 'eurobiketrip'))
      .toBe('2026/03/eurobiketrip/09-first-ride.gpx');
  });

  it('throws when ride_date is missing', () => {
    expect(() => deriveGpxRelativePath('', '09-first-ride.gpx'))
      .toThrow('ride_date is required');
  });

  it('throws when gpx filename is missing', () => {
    expect(() => deriveGpxRelativePath('2026-03-09', ''))
      .toThrow('GPX filename is required');
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
