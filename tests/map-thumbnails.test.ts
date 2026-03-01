import { describe, it, expect } from 'vitest';
import { gpxHash, buildStaticMapUrl, variantKeyFromGpx, mapThumbPaths } from '../src/lib/map-thumbnails';

describe('variantKeyFromGpx', () => {
  it('extracts key from simple gpx filename', () => {
    expect(variantKeyFromGpx('main.gpx')).toBe('main');
  });

  it('strips variants/ prefix', () => {
    expect(variantKeyFromGpx('variants/bike-days.gpx')).toBe('bike-days');
  });

  it('handles nested variant paths', () => {
    expect(variantKeyFromGpx('variants/normal-route.gpx')).toBe('normal-route');
  });
});

describe('mapThumbPaths', () => {
  it('returns route-level paths without variant key', () => {
    const paths = mapThumbPaths('aylmer');
    expect(paths.thumb).toContain('aylmer/map-750.webp');
    expect(paths.thumbSmall).toContain('aylmer/map-375.webp');
    expect(paths.social).toContain('aylmer/map-social.jpg');
    expect(paths.full).toContain('aylmer/map.png');
  });

  it('returns variant-specific paths with variant key', () => {
    const paths = mapThumbPaths('britannia', 'bike-days');
    expect(paths.thumb).toContain('britannia/bike-days/map-750.webp');
    expect(paths.thumbSmall).toContain('britannia/bike-days/map-375.webp');
    expect(paths.social).toContain('britannia/bike-days/map-social.jpg');
    expect(paths.full).toContain('britannia/bike-days/map.png');
  });
});

describe('map-thumbnails', () => {
  it('generates consistent hash for same content', () => {
    const h1 = gpxHash('<gpx>content</gpx>');
    const h2 = gpxHash('<gpx>content</gpx>');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(16);
  });

  it('generates different hash for different content', () => {
    const h1 = gpxHash('<gpx>a</gpx>');
    const h2 = gpxHash('<gpx>b</gpx>');
    expect(h1).not.toBe(h2);
  });

  it('builds a valid Google Maps Static API URL', () => {
    const polyline = 'o}|tGdwn|M_@_@_@_@';
    const url = buildStaticMapUrl(polyline, 'TEST_KEY');
    expect(url).toContain('staticmap');
    expect(url).toContain('key=TEST_KEY');
    expect(url).toContain('enc:');
    expect(url).toContain('markers=color:yellow');
    expect(url).toContain('markers=color:green');
    expect(url).toContain('size=800x800');
    expect(url).toContain('scale=2');
  });
});
