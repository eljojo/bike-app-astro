import { describe, it, expect } from 'vitest';
import { computeElevationPoints } from '../src/lib/geo/elevation-profile';

const hillTrack = [
  { lat: 45.0, lon: -75.0, ele: 50 },
  { lat: 45.001, lon: -75.0, ele: 70 },
  { lat: 45.002, lon: -75.0, ele: 100 },
  { lat: 45.003, lon: -75.0, ele: 80 },
  { lat: 45.004, lon: -75.0, ele: 60 },
];

describe('computeElevationPoints', () => {
  it('returns points with km, ele, lat, lng', () => {
    const result = computeElevationPoints(hillTrack, 5000);
    expect(result.length).toBe(5);
    expect(result[0]).toEqual({ km: 0, ele: 50, lat: 45.0, lng: -75.0 });
    expect(result[result.length - 1].km).toBeCloseTo(5.0);
  });

  it('distributes km evenly across points', () => {
    const result = computeElevationPoints(hillTrack, 10000);
    expect(result[0].km).toBe(0);
    expect(result[result.length - 1].km).toBeCloseTo(10.0);
    // Intermediate points should be evenly spaced
    const step = 10.0 / (result.length - 1);
    for (let i = 0; i < result.length; i++) {
      expect(result[i].km).toBeCloseTo(i * step);
    }
  });

  it('handles missing ele (defaults to 0)', () => {
    const noEleTrack = [
      { lat: 45.0, lon: -75.0 },
      { lat: 45.001, lon: -75.0 },
    ];
    const result = computeElevationPoints(noEleTrack, 1000);
    expect(result[0].ele).toBe(0);
    expect(result[1].ele).toBe(0);
  });

  it('samples down large tracks to ~200 points', () => {
    const largeTrack = Array.from({ length: 1000 }, (_, i) => ({
      lat: 45.0 + i * 0.0001,
      lon: -75.0,
      ele: 50 + Math.sin(i / 50) * 30,
    }));
    const result = computeElevationPoints(largeTrack, 50000);
    expect(result.length).toBeGreaterThan(100);
    expect(result.length).toBeLessThanOrEqual(202);
  });

  it('always includes the last point', () => {
    const largeTrack = Array.from({ length: 500 }, (_, i) => ({
      lat: 45.0 + i * 0.0001,
      lon: -75.0,
      ele: 100,
    }));
    const result = computeElevationPoints(largeTrack, 25000);
    const last = result[result.length - 1];
    expect(last.lat).toBeCloseTo(45.0 + 499 * 0.0001);
    expect(last.km).toBeCloseTo(25.0);
  });

  it('handles single point', () => {
    const single = [{ lat: 45.0, lon: -75.0, ele: 100 }];
    const result = computeElevationPoints(single, 0);
    expect(result.length).toBe(1);
    expect(result[0]).toEqual({ km: 0, ele: 100, lat: 45.0, lng: -75.0 });
  });

  it('maps lon to lng', () => {
    const track = [
      { lat: 45.0, lon: -75.5, ele: 50 },
      { lat: 45.1, lon: -75.6, ele: 60 },
    ];
    const result = computeElevationPoints(track, 1000);
    expect(result[0].lng).toBe(-75.5);
    expect(result[1].lng).toBe(-75.6);
  });
});
