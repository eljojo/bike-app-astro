import { describe, it, expect } from 'vitest';
import { interpolateMediaLocation } from '../src/lib/geo/media-geo-interpolation';

const track = [
  { lat: 45.0, lng: -75.0, time: 0 },
  { lat: 45.1, lng: -75.1, time: 100 },
  { lat: 45.2, lng: -75.2, time: 200 },
  { lat: 45.3, lng: -75.3, time: 300 },
];

describe('interpolateMediaLocation', () => {
  it('interpolates between two bracketing points', () => {
    // Photo taken at t=50 (halfway between points 0 and 1)
    const result = interpolateMediaLocation(50, track);
    expect(result).not.toBeNull();
    expect(result!.lat).toBeCloseTo(45.05, 4);
    expect(result!.lng).toBeCloseTo(-75.05, 4);
  });

  it('snaps to first point when photo is before track start', () => {
    const result = interpolateMediaLocation(-10, track);
    expect(result!.lat).toBe(45.0);
    expect(result!.lng).toBe(-75.0);
  });

  it('snaps to last point when photo is after track end', () => {
    const result = interpolateMediaLocation(500, track);
    expect(result!.lat).toBe(45.3);
    expect(result!.lng).toBe(-75.3);
  });

  it('returns exact point when timestamp matches a track point', () => {
    const result = interpolateMediaLocation(100, track);
    expect(result!.lat).toBe(45.1);
    expect(result!.lng).toBe(-75.1);
  });

  it('returns null for empty track', () => {
    const result = interpolateMediaLocation(50, []);
    expect(result).toBeNull();
  });

  it('handles single-point track', () => {
    const result = interpolateMediaLocation(50, [{ lat: 45.0, lng: -75.0, time: 0 }]);
    expect(result!.lat).toBe(45.0);
  });
});
