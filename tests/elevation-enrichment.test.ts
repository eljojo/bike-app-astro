import { describe, it, expect } from 'vitest';
import {
  downsamplePoints,
  interpolateElevations,
  buildGpxFromPoints,
} from '../src/lib/geo/elevation-enrichment';

describe('downsamplePoints', () => {
  it('returns all points when count is under the limit', () => {
    const points = [
      { lon: -75.7, lat: 45.4 },
      { lon: -75.8, lat: 45.5 },
      { lon: -75.9, lat: 45.6 },
    ];
    const result = downsamplePoints(points, 10);
    expect(result.sampled).toEqual(points);
    expect(result.indices).toEqual([0, 1, 2]);
  });

  it('returns all points when count equals the limit', () => {
    const points = [
      { lon: 0, lat: 0 },
      { lon: 1, lat: 1 },
      { lon: 2, lat: 2 },
    ];
    const result = downsamplePoints(points, 3);
    expect(result.sampled).toEqual(points);
    expect(result.indices).toEqual([0, 1, 2]);
  });

  it('always includes first and last when downsampling', () => {
    const points = Array.from({ length: 10 }, (_, i) => ({
      lon: i,
      lat: i * 10,
    }));
    const result = downsamplePoints(points, 4);
    expect(result.sampled[0]).toEqual(points[0]);
    expect(result.sampled[result.sampled.length - 1]).toEqual(points[9]);
    expect(result.indices[0]).toBe(0);
    expect(result.indices[result.indices.length - 1]).toBe(9);
  });

  it('returns evenly spaced samples', () => {
    const points = Array.from({ length: 10 }, (_, i) => ({
      lon: i,
      lat: i,
    }));
    const result = downsamplePoints(points, 4);
    expect(result.sampled.length).toBe(4);
    expect(result.indices.length).toBe(4);
    // Indices should be evenly spread
    expect(result.indices).toEqual([0, 3, 6, 9]);
  });

  it('handles edge case of maxPoints = 2', () => {
    const points = Array.from({ length: 100 }, (_, i) => ({
      lon: i,
      lat: i,
    }));
    const result = downsamplePoints(points, 2);
    expect(result.sampled.length).toBe(2);
    expect(result.indices).toEqual([0, 99]);
  });

  it('handles single point', () => {
    const points = [{ lon: 1, lat: 2 }];
    const result = downsamplePoints(points, 5);
    expect(result.sampled).toEqual(points);
    expect(result.indices).toEqual([0]);
  });
});

describe('interpolateElevations', () => {
  it('assigns exact elevations at sampled indices', () => {
    const points = [
      { lon: 0, lat: 0 },
      { lon: 1, lat: 1 },
      { lon: 2, lat: 2 },
      { lon: 3, lat: 3 },
      { lon: 4, lat: 4 },
    ];
    const sampledIndices = [0, 2, 4];
    const elevations = [100, 200, 300];

    const result = interpolateElevations(points, sampledIndices, elevations);
    expect(result[0].ele).toBe(100);
    expect(result[2].ele).toBe(200);
    expect(result[4].ele).toBe(300);
  });

  it('linearly interpolates between sampled points', () => {
    const points = [
      { lon: 0, lat: 0 },
      { lon: 1, lat: 1 },
      { lon: 2, lat: 2 },
      { lon: 3, lat: 3 },
      { lon: 4, lat: 4 },
    ];
    const sampledIndices = [0, 4];
    const elevations = [100, 500];

    const result = interpolateElevations(points, sampledIndices, elevations);
    expect(result[0].ele).toBe(100);
    expect(result[1].ele).toBe(200);
    expect(result[2].ele).toBe(300);
    expect(result[3].ele).toBe(400);
    expect(result[4].ele).toBe(500);
  });

  it('preserves lon and lat in output', () => {
    const points = [
      { lon: -75.7, lat: 45.4 },
      { lon: -75.8, lat: 45.5 },
      { lon: -75.9, lat: 45.6 },
    ];
    const sampledIndices = [0, 2];
    const elevations = [80, 120];

    const result = interpolateElevations(points, sampledIndices, elevations);
    expect(result[0]).toEqual({ lon: -75.7, lat: 45.4, ele: 80 });
    expect(result[1]).toEqual({ lon: -75.8, lat: 45.5, ele: 100 });
    expect(result[2]).toEqual({ lon: -75.9, lat: 45.6, ele: 120 });
  });

  it('handles adjacent sampled indices with no gap', () => {
    const points = [
      { lon: 0, lat: 0 },
      { lon: 1, lat: 1 },
      { lon: 2, lat: 2 },
    ];
    const sampledIndices = [0, 1, 2];
    const elevations = [10, 20, 30];

    const result = interpolateElevations(points, sampledIndices, elevations);
    expect(result[0].ele).toBe(10);
    expect(result[1].ele).toBe(20);
    expect(result[2].ele).toBe(30);
  });
});

describe('buildGpxFromPoints', () => {
  it('produces valid GPX XML structure', () => {
    const points = [
      { lon: -75.7, lat: 45.4, ele: 100 },
      { lon: -75.8, lat: 45.5, ele: 110 },
    ];
    const gpx = buildGpxFromPoints('Test Route', points);
    expect(gpx).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(gpx).toContain('<gpx');
    expect(gpx).toContain('<trk>');
    expect(gpx).toContain('<name>Test Route</name>');
    expect(gpx).toContain('<trkseg>');
    expect(gpx).toContain('lat="45.4" lon="-75.7"');
    expect(gpx).toContain('<ele>100</ele>');
    expect(gpx).toContain('lat="45.5" lon="-75.8"');
    expect(gpx).toContain('<ele>110</ele>');
  });

  it('omits ele tag when elevation is undefined', () => {
    const points = [
      { lon: -75.7, lat: 45.4 },
      { lon: -75.8, lat: 45.5, ele: 110 },
    ];
    const gpx = buildGpxFromPoints('No Ele', points);
    // First point should not have <ele>
    expect(gpx).toContain('lat="45.4" lon="-75.7"');
    expect(gpx).not.toContain('<trkpt lat="45.4" lon="-75.7"><ele>');
    // Second point should have <ele>
    expect(gpx).toContain('<ele>110</ele>');
  });

  it('escapes XML special characters in name', () => {
    const points = [{ lon: 0, lat: 0 }];
    const gpx = buildGpxFromPoints('A & B <route>', points);
    expect(gpx).toContain('A &amp; B &lt;route&gt;');
    expect(gpx).not.toContain('A & B <route>');
  });

  it('handles points with no elevation at all', () => {
    const points = [
      { lon: 1, lat: 2 },
      { lon: 3, lat: 4 },
    ];
    const gpx = buildGpxFromPoints('Flat', points);
    expect(gpx).not.toContain('<ele>');
    expect(gpx).toContain('lat="2" lon="1"');
    expect(gpx).toContain('lat="4" lon="3"');
  });
});
