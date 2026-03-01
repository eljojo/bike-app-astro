import { describe, it, expect } from 'vitest';
import { computeElevationProfile } from '../src/lib/elevation-profile';

// A simple uphill-then-downhill track
const hillTrack = [
  { lat: 45.0, lon: -75.0, ele: 50 },
  { lat: 45.001, lon: -75.0, ele: 70 },
  { lat: 45.002, lon: -75.0, ele: 100 },
  { lat: 45.003, lon: -75.0, ele: 80 },
  { lat: 45.004, lon: -75.0, ele: 60 },
];

describe('computeElevationProfile', () => {
  it('computes elevation gain (uphill segments only)', () => {
    const result = computeElevationProfile(hillTrack, 5000);
    // Gain: 50→70 (20) + 70→100 (30) = 50m. Downhill segments ignored.
    expect(result.elevGain).toBe(50);
  });

  it('computes min and max elevation', () => {
    const result = computeElevationProfile(hillTrack, 5000);
    expect(result.minEle).toBe(50);
    expect(result.maxEle).toBe(100);
  });

  it('formats distance in km', () => {
    const result = computeElevationProfile(hillTrack, 5000);
    expect(result.distanceKm).toBe('5.0');

    const result2 = computeElevationProfile(hillTrack, 12345);
    expect(result2.distanceKm).toBe('12.3');
  });

  it('generates valid SVG path starting with M', () => {
    const result = computeElevationProfile(hillTrack, 5000);
    expect(result.svgPath).toMatch(/^M[\d.]+,[\d.]+ L/);
  });

  it('generates closed SVG area path ending with Z', () => {
    const result = computeElevationProfile(hillTrack, 5000);
    expect(result.svgArea).toMatch(/Z$/);
  });

  it('handles flat elevation (no gain)', () => {
    const flatTrack = [
      { lat: 45.0, lon: -75.0, ele: 80 },
      { lat: 45.001, lon: -75.0, ele: 80 },
      { lat: 45.002, lon: -75.0, ele: 80 },
    ];
    const result = computeElevationProfile(flatTrack, 3000);
    expect(result.elevGain).toBe(0);
    expect(result.minEle).toBe(80);
    expect(result.maxEle).toBe(80);
  });

  it('handles missing ele (defaults to 0)', () => {
    const noEleTrack = [
      { lat: 45.0, lon: -75.0 },
      { lat: 45.001, lon: -75.0 },
    ];
    const result = computeElevationProfile(noEleTrack, 1000);
    expect(result.elevGain).toBe(0);
    expect(result.minEle).toBe(0);
    expect(result.maxEle).toBe(0);
  });

  it('samples down large tracks to ~200 points', () => {
    const largeTrack = Array.from({ length: 1000 }, (_, i) => ({
      lat: 45.0 + i * 0.0001,
      lon: -75.0,
      ele: 50 + Math.sin(i / 50) * 30,
    }));
    const result = computeElevationProfile(largeTrack, 50000);
    const pointCount = result.svgPath.split('L').length;
    expect(pointCount).toBeGreaterThan(100);
    expect(pointCount).toBeLessThanOrEqual(202);
  });

  it('generates Y-axis ticks with elevation labels', () => {
    const result = computeElevationProfile(hillTrack, 5000);
    expect(result.yTicks.length).toBeGreaterThan(0);
    for (const tick of result.yTicks) {
      expect(tick.label).toMatch(/^\d+m$/);
      expect(tick.value).toBeGreaterThanOrEqual(result.minEle);
      expect(tick.value).toBeLessThanOrEqual(result.maxEle);
      expect(tick.position).toBeGreaterThan(0);
    }
  });

  it('generates X-axis ticks with distance labels', () => {
    const result = computeElevationProfile(hillTrack, 5000);
    expect(result.xTicks.length).toBeGreaterThan(0);
    expect(result.xTicks[0].value).toBe(0);
    for (const tick of result.xTicks) {
      expect(tick.value).toBeLessThanOrEqual(5);
      expect(tick.position).toBeGreaterThan(0);
    }
  });
});
