import { describe, it, expect } from 'vitest';
import { quantiles, elevationConclusion, elevationTags, getAllElevations } from '../src/lib/elevation';

describe('quantiles', () => {
  it('computes median of odd-length array', () => {
    expect(quantiles([10, 20, 30, 40, 50], [0.5])).toEqual([30]);
  });

  it('interpolates for even-length array', () => {
    expect(quantiles([10, 20, 30, 40], [0.5])).toEqual([25]);
  });

  it('returns min and max for 0 and 1 probabilities', () => {
    expect(quantiles([5, 15, 25], [0, 1])).toEqual([5, 25]);
  });

  it('handles single-element array', () => {
    expect(quantiles([42], [0.5])).toEqual([42]);
  });

  it('sorts input before computing', () => {
    expect(quantiles([50, 10, 30], [0.5])).toEqual([30]);
  });
});

describe('elevationConclusion', () => {
  // Use a spread of elevations to produce meaningful quantiles
  const allElevations = [10, 30, 50, 80, 100, 150, 200, 300, 400, 500];

  it('returns flat label for very low elevation', () => {
    const result = elevationConclusion(10, allElevations);
    expect(result).toContain('flat');
  });

  it('returns hard label for very high elevation', () => {
    const result = elevationConclusion(500, allElevations);
    expect(result).toContain('hard');
  });

  it('returns the last label when elevation exceeds all quantiles', () => {
    const result = elevationConclusion(9999, allElevations);
    expect(result).toBe('very very hard elevation ⚠️🌋');
  });
});

describe('elevationTags', () => {
  const allElevations = [10, 30, 50, 80, 100, 150, 200, 300, 400, 500];

  it('returns ["flat"] for low elevation gain', () => {
    expect(elevationTags(10, allElevations)).toEqual(['flat']);
  });

  it('returns ["elevation"] for high elevation gain', () => {
    expect(elevationTags(500, allElevations)).toEqual(['elevation']);
  });

  it('returns empty array for mid-range elevation', () => {
    expect(elevationTags(150, allElevations)).toEqual([]);
  });

  it('returns empty array for null elevation', () => {
    expect(elevationTags(null, allElevations)).toEqual([]);
  });

  it('returns empty array for zero elevation', () => {
    expect(elevationTags(0, allElevations)).toEqual([]);
  });
});

describe('getAllElevations', () => {
  it('extracts elevation from published routes', () => {
    const routes = [
      { data: { status: 'published', variants: [{ gpx: 'a.gpx' }], gpxTracks: { 'a.gpx': { elevation_gain_m: 100 } } } },
      { data: { status: 'published', variants: [{ gpx: 'b.gpx' }], gpxTracks: { 'b.gpx': { elevation_gain_m: 200 } } } },
    ];
    expect(getAllElevations(routes as any)).toEqual([100, 200]);
  });

  it('excludes draft routes', () => {
    const routes = [
      { data: { status: 'draft', variants: [{ gpx: 'a.gpx' }], gpxTracks: { 'a.gpx': { elevation_gain_m: 100 } } } },
      { data: { status: 'published', variants: [{ gpx: 'b.gpx' }], gpxTracks: { 'b.gpx': { elevation_gain_m: 200 } } } },
    ];
    expect(getAllElevations(routes as any)).toEqual([200]);
  });

  it('excludes routes with no GPX track', () => {
    const routes = [
      { data: { status: 'published', variants: [], gpxTracks: {} } },
    ];
    expect(getAllElevations(routes as any)).toEqual([]);
  });

  it('excludes routes with zero elevation', () => {
    const routes = [
      { data: { status: 'published', variants: [{ gpx: 'a.gpx' }], gpxTracks: { 'a.gpx': { elevation_gain_m: 0 } } } },
    ];
    expect(getAllElevations(routes as any)).toEqual([]);
  });
});
