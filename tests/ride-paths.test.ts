import { describe, it, expect } from 'vitest';
import { rideFilePathsFromRelPath, rideFilePathsWithTour, renameGpxRelPath } from '../src/lib/ride-paths';

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

