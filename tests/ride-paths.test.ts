import { describe, it, expect } from 'vitest';
import { rideFilePathsFromRelPath, rideSlugFromPath } from '../src/lib/ride-paths';

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

describe('rideSlugFromPath', () => {
  it('returns name-only slug from relative GPX path', () => {
    expect(rideSlugFromPath('rides/2026/01/23-winter-ride.gpx')).toBe('winter-ride');
  });

  it('returns name-only slug from sidecar path', () => {
    expect(rideSlugFromPath('rides/2025/09/05-canal-ride.md')).toBe('canal-ride');
  });

  it('returns name-only slug from tour ride GPX path', () => {
    expect(rideSlugFromPath('rides/2025/07/euro-tour/15-paris-to-lyon.gpx'))
      .toBe('paris-to-lyon');
  });

  it('strips MM-DD prefix for multi-month tours', () => {
    expect(rideSlugFromPath('rides/2023/long-tour/01-23-first-day.gpx'))
      .toBe('first-day');
  });

  it('throws on invalid path format', () => {
    expect(() => rideSlugFromPath('rides/ride.gpx')).toThrow('Invalid ride path');
  });
});
