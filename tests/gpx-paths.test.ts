import { describe, it, expect } from 'vitest';
import {
  routeGpxGitPath, rideGpxGitPath,
  routeGpxPath, rideGpxPath,
  variantSlug, variantKey, variantFilename,
} from '../src/lib/gpx/paths';

describe('routeGpxGitPath', () => {
  it('builds git-relative path for route variant', () => {
    expect(routeGpxGitPath('ottawa', 'canal', 'variants/return.gpx'))
      .toBe('ottawa/routes/canal/variants/return.gpx');
  });

  it('builds git-relative path for main GPX', () => {
    expect(routeGpxGitPath('ottawa', 'canal', 'main.gpx'))
      .toBe('ottawa/routes/canal/main.gpx');
  });
});

describe('rideGpxGitPath', () => {
  it('builds git-relative path for ride', () => {
    expect(rideGpxGitPath('blog', '2026/03/15-morning.gpx'))
      .toBe('blog/rides/2026/03/15-morning.gpx');
  });
});

describe('routeGpxPath', () => {
  it('builds absolute path for route GPX', () => {
    expect(routeGpxPath('/data/ottawa', 'canal', 'variants/return.gpx'))
      .toBe('/data/ottawa/routes/canal/variants/return.gpx');
  });
});

describe('rideGpxPath', () => {
  it('builds absolute path for ride GPX', () => {
    expect(rideGpxPath('/data/blog', '2026/03/13-morning-ride.gpx'))
      .toBe('/data/blog/rides/2026/03/13-morning-ride.gpx');
  });
});

describe('variantSlug', () => {
  it('extracts slug from variant path', () => {
    expect(variantSlug('variants/return.gpx')).toBe('return');
  });

  it('extracts slug from simple filename', () => {
    expect(variantSlug('main.gpx')).toBe('main');
  });
});

describe('variantKey', () => {
  it('builds key from variant path', () => {
    expect(variantKey('variants/return.gpx')).toBe('variants-return');
  });

  it('builds key from simple filename', () => {
    expect(variantKey('main.gpx')).toBe('main');
  });
});

describe('variantFilename', () => {
  it('extracts filename from variant path', () => {
    expect(variantFilename('variants/return.gpx')).toBe('return.gpx');
  });

  it('keeps simple filename unchanged', () => {
    expect(variantFilename('main.gpx')).toBe('main.gpx');
  });
});
