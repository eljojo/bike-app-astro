import { describe, it, expect } from 'vitest';
import { filterPrivacyZone, filterPrivacyZones, stripPrivacyMedia, computeDynamicZones, type PrivacyZoneConfig } from '../src/lib/geo/privacy-zone';
import { buildTrackFromPoints, type GpxPoint } from '../src/lib/gpx/parse';

/**
 * Tests for privacy zone integration with GpxPoint (lon) → privacy zone (lng) mapping.
 * The rides loader maps GpxPoint.lon to TrackPoint.lng before calling filterPrivacyZone.
 */
describe('privacy zone with GpxPoint mapping', () => {
  const zone: PrivacyZoneConfig = {
    lat: 45.4215,
    lng: -75.6972,
    radius_m: 500,
  };

  // Points: first is at the zone center, rest are far away
  const gpxPoints: GpxPoint[] = [
    { lat: 45.4215, lon: -75.6972, ele: 70 },   // at zone center
    { lat: 45.4216, lon: -75.6971, ele: 71 },   // very close to center (within 500m)
    { lat: 45.4500, lon: -75.6500, ele: 80 },   // ~4km away
    { lat: 45.4600, lon: -75.6400, ele: 85 },   // ~5km away
    { lat: 45.4700, lon: -75.6300, ele: 90 },   // ~6km away
  ];

  it('filters GpxPoints after lon→lng mapping', () => {
    // Simulate the rides loader's mapping logic (only pass fields filterPrivacyZone needs)
    const mappedPoints = gpxPoints.map(p => ({ lat: p.lat, lng: p.lon, ele: p.ele }));
    const filtered = filterPrivacyZone(mappedPoints, zone);
    const result = filtered.map(p => ({ lat: p.lat, lon: p.lng, ele: p.ele } as GpxPoint));

    // First two points are within 500m of zone center → removed
    expect(result.length).toBe(3);
    expect(result[0].lat).toBeCloseTo(45.45);
    expect(result[0].lon).toBeCloseTo(-75.65);
  });

  it('preserves all points when none are in zone', () => {
    const farZone: PrivacyZoneConfig = { lat: 0, lng: 0, radius_m: 100 };
    const mappedPoints = gpxPoints.map(p => ({ lat: p.lat, lng: p.lon, ele: p.ele }));
    const filtered = filterPrivacyZone(mappedPoints, farZone);
    expect(filtered).toHaveLength(5);
  });

  it('recomputes track metrics after privacy zone filtering', () => {
    const fullTrack = buildTrackFromPoints(gpxPoints);

    // Filter and recompute
    const mappedPoints = gpxPoints.map(p => ({ lat: p.lat, lng: p.lon, ele: p.ele }));
    const filtered = filterPrivacyZone(mappedPoints, zone);
    const filteredGpxPoints: GpxPoint[] = filtered.map(p => ({ lat: p.lat, lon: p.lng, ele: p.ele }));
    const filteredTrack = buildTrackFromPoints(filteredGpxPoints);

    // Filtered track should have fewer points and different distance
    expect(filteredTrack.points.length).toBeLessThan(fullTrack.points.length);
    expect(filteredTrack.distance_m).not.toBe(fullTrack.distance_m);
    expect(filteredTrack.polyline).not.toBe(fullTrack.polyline);
  });
});

describe('privacy zone photo stripping with RouteMedia', () => {
  const zone: PrivacyZoneConfig = {
    lat: 45.4215,
    lng: -75.6972,
    radius_m: 500,
  };

  it('strips coordinates from photos inside zone', () => {
    const media = [
      { key: 'photo1.jpg', lat: 45.4215, lng: -75.6972 },  // at zone center
      { key: 'photo2.jpg', lat: 45.5000, lng: -75.6000 },  // far away
      { key: 'photo3.jpg' },                                 // no coordinates
    ];

    const result = stripPrivacyMedia(media, zone);

    // Photo 1: coordinates stripped (inside zone)
    expect(result[0].key).toBe('photo1.jpg');
    expect(result[0].lat).toBeUndefined();
    expect(result[0].lng).toBeUndefined();

    // Photo 2: coordinates preserved (outside zone)
    expect(result[1].lat).toBeCloseTo(45.5);
    expect(result[1].lng).toBeCloseTo(-75.6);

    // Photo 3: unchanged (no coordinates to strip)
    expect(result[2].key).toBe('photo3.jpg');
  });

  it('does not mutate input array', () => {
    const media = [
      { key: 'photo1.jpg', lat: 45.4215, lng: -75.6972 },
    ];
    const original = { ...media[0] };
    stripPrivacyMedia(media, zone);
    expect(media[0].lat).toBe(original.lat);
    expect(media[0].lng).toBe(original.lng);
  });
});

describe('dynamic privacy zones with GpxPoint lon→lng mapping', () => {
  // Simulates the rides loader flow: GpxPoint uses `lon`, privacy zone uses `lng`
  // The loader maps lon→lng before calling computeDynamicZones + filterPrivacyZones

  it('filters ride start/end after lon→lng mapping (no static config)', () => {
    // This is the exact flow for a blog with privacy_zone: true and no config lat/lng
    const gpxPoints: GpxPoint[] = [
      { lat: 45.4215, lon: -75.6972, ele: 70 },   // start (home)
      { lat: 45.4220, lon: -75.6960, ele: 71 },   // near home
      { lat: 45.4280, lon: -75.6900, ele: 75 },   // ~770m away
      { lat: 45.4500, lon: -75.6500, ele: 80 },   // far away
      { lat: 45.4600, lon: -75.6400, ele: 85 },   // further
      { lat: 45.4500, lon: -75.6500, ele: 80 },   // returning
      { lat: 45.4280, lon: -75.6900, ele: 75 },   // ~770m away
      { lat: 45.4220, lon: -75.6960, ele: 71 },   // near home
      { lat: 45.4215, lon: -75.6972, ele: 70 },   // end (home)
    ];

    // Step 1: map lon→lng (as the loader does)
    const mappedPoints = gpxPoints.map(p => ({ lat: p.lat, lng: p.lon, ele: p.ele }));

    // Step 2: compute dynamic zones (no static config)
    const slug = '2026-03-09-first-ride-of-the-year';
    const zones = computeDynamicZones(mappedPoints, slug);

    // Step 3: filter
    const filtered = filterPrivacyZones(mappedPoints, zones);

    // Step 4: map back to GpxPoint
    const result: GpxPoint[] = filtered.map(p => ({ lat: p.lat, lon: p.lng, ele: p.ele }));

    // Home points (start, near-home, end) should be removed
    expect(result.length).toBeLessThan(gpxPoints.length);
    expect(result.length).toBeGreaterThan(0);

    // First remaining point should NOT be near home
    expect(result[0].lat).not.toBeCloseTo(45.4215, 3);
  });

  it('recomputes track after dynamic zone filtering', () => {
    const gpxPoints: GpxPoint[] = [
      { lat: 45.4215, lon: -75.6972, ele: 70 },   // start (home)
      { lat: 45.4220, lon: -75.6960, ele: 71 },   // near home
      { lat: 45.4500, lon: -75.6500, ele: 80 },   // far away
      { lat: 45.4600, lon: -75.6400, ele: 85 },   // further
      { lat: 45.4220, lon: -75.6960, ele: 71 },   // near home
      { lat: 45.4215, lon: -75.6972, ele: 70 },   // end (home)
    ];

    const fullTrack = buildTrackFromPoints(gpxPoints);

    const mappedPoints = gpxPoints.map(p => ({ lat: p.lat, lng: p.lon, ele: p.ele }));
    const zones = computeDynamicZones(mappedPoints, 'test-ride');
    const filtered = filterPrivacyZones(mappedPoints, zones);
    const filteredGpxPoints: GpxPoint[] = filtered.map(p => ({ lat: p.lat, lon: p.lng, ele: p.ele }));
    const filteredTrack = buildTrackFromPoints(filteredGpxPoints);

    // Filtered track should have fewer points, different distance, different polyline
    expect(filteredTrack.points.length).toBeLessThan(fullTrack.points.length);
    expect(filteredTrack.distance_m).not.toBe(fullTrack.distance_m);
    expect(filteredTrack.polyline).not.toBe(fullTrack.polyline);
  });
});
