import { describe, it, expect } from 'vitest';
import { computeOverlapDistanceKm } from '../src/lib/bike-paths/bike-path-relations.server';

describe('computeOverlapDistanceKm', () => {
  it('returns 0 when no points are near', () => {
    const trackPoints = [
      { lat: 45.0, lng: -75.0 },
      { lat: 45.001, lng: -75.001 },
    ];
    expect(computeOverlapDistanceKm(trackPoints, () => false)).toBe(0);
  });

  it('sums distance between consecutive near points', () => {
    const trackPoints = [
      { lat: 45.0, lng: -75.0 },
      { lat: 45.001, lng: -75.0 },
      { lat: 45.002, lng: -75.0 },
    ];
    const result = computeOverlapDistanceKm(trackPoints, () => true);
    expect(result).toBeGreaterThanOrEqual(0.2);
    expect(result).toBeLessThan(0.25);
  });

  it('skips gaps where points are not near', () => {
    const trackPoints = [
      { lat: 45.0, lng: -75.0 },
      { lat: 45.001, lng: -75.0 },
      { lat: 45.002, lng: -75.0 },
      { lat: 45.003, lng: -75.0 },
    ];
    const nearIndices = new Set([0, 2, 3]);
    const result = computeOverlapDistanceKm(
      trackPoints,
      (_lat: number, _lng: number, i: number) => nearIndices.has(i),
    );
    expect(result).toBeGreaterThanOrEqual(0.1);
    expect(result).toBeLessThan(0.13);
  });

  it('rounds to one decimal place', () => {
    const trackPoints = [
      { lat: 45.0, lng: -75.0 },
      { lat: 45.01, lng: -75.0 },
    ];
    const result = computeOverlapDistanceKm(trackPoints, () => true);
    expect(result).toBe(Math.round(result * 10) / 10);
  });
});
