import { describe, it, expect } from 'vitest';
import { variantSlug, variantFilename, routeGpxPath, rideGpxPath } from '../src/lib/gpx/download';

describe('variantSlug', () => {
  it('strips .gpx from simple filename', () => {
    expect(variantSlug('track.gpx')).toBe('track');
  });

  it('strips variants/ prefix and .gpx', () => {
    expect(variantSlug('variants/return.gpx')).toBe('return');
  });

  it('handles multi-word names', () => {
    expect(variantSlug('variants/bike-days.gpx')).toBe('bike-days');
  });
});

describe('variantFilename', () => {
  it('keeps simple filename unchanged', () => {
    expect(variantFilename('track.gpx')).toBe('track.gpx');
  });

  it('strips variants/ prefix', () => {
    expect(variantFilename('variants/return.gpx')).toBe('return.gpx');
  });
});

describe('routeGpxPath', () => {
  it('constructs path for main track', () => {
    expect(routeGpxPath('/data/ottawa', 'canal', 'track.gpx')).toBe('/data/ottawa/routes/canal/track.gpx');
  });

  it('constructs path for variant', () => {
    expect(routeGpxPath('/data/ottawa', 'canal', 'variants/return.gpx')).toBe('/data/ottawa/routes/canal/variants/return.gpx');
  });
});

describe('rideGpxPath', () => {
  it('constructs path from relative path', () => {
    expect(rideGpxPath('/data/blog', '2026/03/13-morning-ride.gpx')).toBe('/data/blog/rides/2026/03/13-morning-ride.gpx');
  });
});
