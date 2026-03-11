import { describe, it, expect } from 'vitest';
import { rideSlugToDir, rideFilePaths, rideSlugFromPath } from '../src/lib/ride-paths';

describe('rideSlugToDir', () => {
  it('extracts year, month, and base from slug', () => {
    expect(rideSlugToDir('2026-01-23-winter-ride', 'blog')).toEqual({
      dir: 'blog/rides/2026/01',
      base: '23-winter-ride',
    });
  });

  it('handles multi-hyphen ride name', () => {
    expect(rideSlugToDir('2025-09-05-my-long-ride-name', 'blog')).toEqual({
      dir: 'blog/rides/2025/09',
      base: '05-my-long-ride-name',
    });
  });
});

describe('rideFilePaths', () => {
  it('returns gpx, sidecar, and media paths', () => {
    const paths = rideFilePaths('2026-01-23-winter-ride', 'blog');
    expect(paths).toEqual({
      gpx: 'blog/rides/2026/01/23-winter-ride.gpx',
      sidecar: 'blog/rides/2026/01/23-winter-ride.md',
      media: 'blog/rides/2026/01/23-winter-ride-media.yml',
    });
  });
});

describe('rideSlugFromPath', () => {
  it('builds slug from relative GPX path', () => {
    expect(rideSlugFromPath('rides/2026/01/23-winter-ride.gpx')).toBe('2026-01-23-winter-ride');
  });

  it('builds slug from sidecar path', () => {
    expect(rideSlugFromPath('rides/2025/09/05-canal-ride.md')).toBe('2025-09-05-canal-ride');
  });
});
