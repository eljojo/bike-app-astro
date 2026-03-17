import { describe, it, expect } from 'vitest';
import { findNearbyPlaces, type PlaceData } from '../src/lib/geo/proximity';
import type { GpxPoint } from '../src/lib/gpx/parse';

// A dense east-west track along ~45.42°N in Ottawa (points ~100m apart, like real GPX)
const track: GpxPoint[] = [];
for (let i = 0; i <= 30; i++) {
  track.push({ lat: 45.4215, lon: -75.7100 + i * 0.001 });
}

function makePlace(id: string, lat: number, lng: number): PlaceData {
  return { id, name: id, category: 'cafe', lat, lng };
}

describe('findNearbyPlaces', () => {
  it('returns empty for fewer than 2 track points', () => {
    const places = [makePlace('a', 45.4215, -75.7000)];
    expect(findNearbyPlaces([{ lat: 45, lon: -75 }], places)).toEqual([]);
    expect(findNearbyPlaces([], places)).toEqual([]);
  });

  it('finds a place right on the track', () => {
    const places = [makePlace('on-track', 45.4215, -75.7000)];
    const result = findNearbyPlaces(track, places);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('on-track');
    expect(result[0].distance_m).toBe(0);
  });

  it('finds a place within 300m of the track', () => {
    // ~200m north of the track (0.0018° lat ≈ 200m)
    const places = [makePlace('nearby', 45.4233, -75.6900)];
    const result = findNearbyPlaces(track, places);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('nearby');
    expect(result[0].distance_m).toBeGreaterThan(100);
    expect(result[0].distance_m).toBeLessThanOrEqual(300);
  });

  it('excludes a place far from the track', () => {
    // ~5km north
    const places = [makePlace('far-away', 45.47, -75.7000)];
    expect(findNearbyPlaces(track, places)).toHaveLength(0);
  });

  it('excludes a place just outside the 300m threshold', () => {
    // ~400m north (0.0036° lat ≈ 400m)
    const places = [makePlace('just-outside', 45.4251, -75.6900)];
    expect(findNearbyPlaces(track, places)).toHaveLength(0);
  });

  it('returns results sorted by distance', () => {
    const places = [
      makePlace('farther', 45.4230, -75.6900), // ~167m north
      makePlace('closer', 45.4220, -75.6900),  // ~56m north
      makePlace('on-track', 45.4215, -75.7000), // 0m
    ];
    const result = findNearbyPlaces(track, places);
    expect(result).toHaveLength(3);
    expect(result.map(r => r.id)).toEqual(['on-track', 'closer', 'farther']);
    expect(result[0].distance_m).toBeLessThan(result[1].distance_m);
    expect(result[1].distance_m).toBeLessThan(result[2].distance_m);
  });

  it('does not exclude places near the track edges', () => {
    // Place near the western end of the track, slightly south
    const places = [makePlace('edge', 45.4200, -75.7095)];
    const result = findNearbyPlaces(track, places);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('edge');
  });

  it('excludes places far east/west of track', () => {
    // Place at correct latitude but way east of the track
    const places = [makePlace('wrong-lon', 45.4215, -75.6000)];
    expect(findNearbyPlaces(track, places)).toHaveLength(0);
  });

  it('mixes nearby and far places correctly', () => {
    const places = [
      makePlace('near', 45.4220, -75.6970),
      makePlace('far', 45.5000, -75.5000),
      makePlace('also-near', 45.4210, -75.6850),
    ];
    const result = findNearbyPlaces(track, places);
    expect(result.map(p => p.id)).toContain('near');
    expect(result.map(p => p.id)).toContain('also-near');
    expect(result.map(p => p.id)).not.toContain('far');
  });
});
