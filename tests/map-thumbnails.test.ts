import { describe, it, expect } from 'vitest';
import { buildStaticMapUrl, variantKeyFromGpx, mapThumbPaths } from '../src/lib/map-thumbnails';
import { gpxHash } from '../src/lib/map-generation';

describe('variantKeyFromGpx', () => {
  it('extracts key from simple gpx filename', () => {
    expect(variantKeyFromGpx('main.gpx')).toBe('main');
  });

  it('prefixes variants/ with variants-', () => {
    expect(variantKeyFromGpx('variants/bike-days.gpx')).toBe('variants-bike-days');
  });

  it('handles nested variant paths', () => {
    expect(variantKeyFromGpx('variants/normal-route.gpx')).toBe('variants-normal-route');
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

  it('returns locale-prefixed paths when lang is provided', () => {
    const paths = mapThumbPaths('aylmer', undefined, 'fr');
    expect(paths.thumb).toContain('fr/aylmer/map-750.webp');
    expect(paths.full).toContain('fr/aylmer/map.png');
  });

  it('returns locale-prefixed variant paths', () => {
    const paths = mapThumbPaths('britannia', 'bike-days', 'fr');
    expect(paths.thumb).toContain('fr/britannia/bike-days/map-750.webp');
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

  it('includes language parameter when provided', () => {
    const polyline = 'o}|tGdwn|M_@_@_@_@';
    const url = buildStaticMapUrl(polyline, 'TEST_KEY', 'fr');
    expect(url).toContain('language=fr');
  });

  it('omits language parameter when not provided', () => {
    const polyline = 'o}|tGdwn|M_@_@_@_@';
    const url = buildStaticMapUrl(polyline, 'TEST_KEY');
    expect(url).not.toContain('language=');
  });
});
