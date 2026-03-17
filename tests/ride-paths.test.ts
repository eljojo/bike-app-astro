import { describe, it, expect } from 'vitest';
import { rideFilePathsFromRelPath, rideFilePathsWithTour, deriveGpxRelativePath, renameGpxRelPath, suffixGpxRelPath, suffixRideSlug } from '../src/lib/ride-paths';

describe('rideFilePathsFromRelPath', () => {
  it('returns gpx, sidecar, and media paths from relative GPX path', () => {
    const paths = rideFilePathsFromRelPath('2026/01/23-winter-ride.gpx', 'blog');
    expect(paths).toEqual({
      gpx: 'blog/rides/2026/01/23-winter-ride.gpx',
      sidecar: 'blog/rides/2026/01/23-winter-ride.md',
      media: 'blog/rides/2026/01/23-winter-ride-media.yml',
    });
  });

  it('handles tour ride paths', () => {
    const paths = rideFilePathsFromRelPath('2025/07/euro-tour/15-paris-to-lyon.gpx', 'blog');
    expect(paths).toEqual({
      gpx: 'blog/rides/2025/07/euro-tour/15-paris-to-lyon.gpx',
      sidecar: 'blog/rides/2025/07/euro-tour/15-paris-to-lyon.md',
      media: 'blog/rides/2025/07/euro-tour/15-paris-to-lyon-media.yml',
    });
  });
});

describe('rideFilePathsWithTour', () => {
  it('inserts tour slug into path', () => {
    const result = rideFilePathsWithTour('2026/01/15-sprint.gpx', 'euro-trip', 'blog');
    expect(result.gpx).toBe('blog/rides/2026/01/euro-trip/15-sprint.gpx');
  });

  it('returns unchanged paths when no tour', () => {
    const result = rideFilePathsWithTour('2026/01/15-sprint.gpx', undefined, 'blog');
    expect(result.gpx).toBe('blog/rides/2026/01/15-sprint.gpx');
  });
});

describe('deriveGpxRelativePath', () => {
  it('normalizes YYYY-MM-DD prefixed filename from Strava import', () => {
    expect(deriveGpxRelativePath('2026-03-09', '2026-03-09-first-ride.gpx'))
      .toBe('2026/03/09-first-ride.gpx');
  });

  it('adds day prefix to bare filename from GPX upload', () => {
    expect(deriveGpxRelativePath('2026-03-09', 'morning-ride.gpx'))
      .toBe('2026/03/09-morning-ride.gpx');
  });

  it('keeps already-correct DD-name.gpx unchanged', () => {
    expect(deriveGpxRelativePath('2026-01-23', '23-winter-ride.gpx'))
      .toBe('2026/01/23-winter-ride.gpx');
  });

  it('includes tour slug in path', () => {
    expect(deriveGpxRelativePath('2025-09-09', '09-amsterdam.gpx', 'euro-trip'))
      .toBe('2025/09/euro-trip/09-amsterdam.gpx');
  });

  it('normalizes full-date filename with tour', () => {
    expect(deriveGpxRelativePath('2025-09-09', '2025-09-09-amsterdam.gpx', 'euro-trip'))
      .toBe('2025/09/euro-trip/09-amsterdam.gpx');
  });

  it('throws on missing ride_date', () => {
    expect(() => deriveGpxRelativePath('', 'ride.gpx')).toThrow();
  });

  it('throws on incomplete ride_date', () => {
    expect(() => deriveGpxRelativePath('2026-03', 'ride.gpx')).toThrow();
  });
});

describe('renameGpxRelPath', () => {
  it('strips date prefix from slug for filename', () => {
    expect(renameGpxRelPath('2026/01/23-morning-ride.gpx', '2026-01-23-sunrise-ride'))
      .toBe('2026/01/23-sunrise-ride.gpx');
  });

  it('handles tour ride slug without date prefix', () => {
    expect(renameGpxRelPath('2025/07/euro-tour/15-paris-to-lyon.gpx', 'paris-lyon'))
      .toBe('2025/07/euro-tour/15-paris-lyon.gpx');
  });
});

describe('suffixGpxRelPath', () => {
  it('appends numeric suffix before .gpx extension', () => {
    expect(suffixGpxRelPath('2026/03/13-morning-ride.gpx', 2))
      .toBe('2026/03/13-morning-ride-2.gpx');
  });

  it('works with tour paths', () => {
    expect(suffixGpxRelPath('2025/07/euro-tour/15-paris.gpx', 3))
      .toBe('2025/07/euro-tour/15-paris-3.gpx');
  });
});

describe('suffixRideSlug', () => {
  it('appends numeric suffix to slug', () => {
    expect(suffixRideSlug('2026-03-13-morning-ride', 2))
      .toBe('2026-03-13-morning-ride-2');
  });

  it('works with tour slugs', () => {
    expect(suffixRideSlug('day-1', 4))
      .toBe('day-1-4');
  });
});

