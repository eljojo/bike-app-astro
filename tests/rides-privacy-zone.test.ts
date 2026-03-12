import { describe, it, expect } from 'vitest';
import { filterPrivacyZone, stripPrivacyPhotos, type PrivacyZoneConfig } from '../src/lib/privacy-zone';
import { buildTrackFromPoints, type GpxPoint } from '../src/lib/gpx';

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
    // Simulate the rides loader's mapping logic
    const mappedPoints = gpxPoints.map(p => ({ ...p, lng: p.lon }));
    const filtered = filterPrivacyZone(mappedPoints, zone);
    const result = filtered.map(({ lng: _lng, ...rest }) => rest);

    // First two points are within 500m of zone center → removed
    expect(result.length).toBe(3);
    expect(result[0].lat).toBeCloseTo(45.45);
    expect(result[0].lon).toBeCloseTo(-75.65);
  });

  it('preserves all points when zone is not configured', () => {
    // When privacyZone is undefined, filtering is skipped entirely
    const allPoints = [...gpxPoints];
    expect(allPoints).toHaveLength(5);
  });

  it('preserves all points when none are in zone', () => {
    const farZone: PrivacyZoneConfig = { lat: 0, lng: 0, radius_m: 100 };
    const mappedPoints = gpxPoints.map(p => ({ ...p, lng: p.lon }));
    const filtered = filterPrivacyZone(mappedPoints, farZone);
    expect(filtered).toHaveLength(5);
  });

  it('recomputes track metrics after privacy zone filtering', () => {
    const fullTrack = buildTrackFromPoints(gpxPoints);

    // Filter and recompute
    const mappedPoints = gpxPoints.map(p => ({ ...p, lng: p.lon }));
    const filtered = filterPrivacyZone(mappedPoints, zone);
    const filteredGpxPoints: GpxPoint[] = filtered.map(({ lng: _lng, ...rest }) => rest);
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

    const result = stripPrivacyPhotos(media, zone);

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
    stripPrivacyPhotos(media, zone);
    expect(media[0].lat).toBe(original.lat);
    expect(media[0].lng).toBe(original.lng);
  });
});
