import { describe, it, expect } from 'vitest';
import { filterPrivacyZone, stripPrivacyMedia } from '../src/lib/geo/privacy-zone';

const zone = { lat: 45.4, lng: -75.7, radius_m: 500 };

describe('filterPrivacyZone', () => {
  it('removes points within the exclusion radius', () => {
    const points = [
      { lat: 45.4, lng: -75.7, ele: 60, time: 0 },     // inside zone (center)
      { lat: 45.41, lng: -75.7, ele: 65, time: 100 },   // outside (~1.1km away)
      { lat: 45.42, lng: -75.7, ele: 70, time: 200 },   // outside
    ];
    const result = filterPrivacyZone(points, zone);
    expect(result).toHaveLength(2);
    expect(result[0].lat).toBe(45.41);
  });

  it('merges remaining segments into one continuous track', () => {
    // Leave zone → pass through zone → leave zone again
    const points = [
      { lat: 45.42, lng: -75.7, ele: 60, time: 0 },     // outside (start)
      { lat: 45.41, lng: -75.7, ele: 65, time: 100 },    // outside
      { lat: 45.4, lng: -75.7, ele: 60, time: 200 },     // inside (mid-ride)
      { lat: 45.401, lng: -75.7, ele: 60, time: 250 },   // inside
      { lat: 45.41, lng: -75.71, ele: 70, time: 300 },   // outside again
      { lat: 45.42, lng: -75.71, ele: 75, time: 400 },   // outside
    ];
    const result = filterPrivacyZone(points, zone);
    // Points 0,1 (before zone) and 4,5 (after zone) — merged into one array
    expect(result).toHaveLength(4);
    expect(result[0].time).toBe(0);
    expect(result[3].time).toBe(400);
  });

  it('returns all points when none are in the zone', () => {
    const points = [
      { lat: 45.5, lng: -75.7, ele: 60, time: 0 },
      { lat: 45.51, lng: -75.7, ele: 65, time: 100 },
    ];
    const result = filterPrivacyZone(points, zone);
    expect(result).toHaveLength(2);
  });

  it('returns empty array when all points are in the zone', () => {
    const points = [
      { lat: 45.4, lng: -75.7, ele: 60, time: 0 },
      { lat: 45.4001, lng: -75.7001, ele: 65, time: 100 },
    ];
    const result = filterPrivacyZone(points, zone);
    expect(result).toHaveLength(0);
  });
});

describe('stripPrivacyMedia', () => {
  it('nullifies lat/lng for photos inside the zone', () => {
    const photos = [
      { key: 'a', lat: 45.4, lng: -75.7 },    // inside
      { key: 'b', lat: 45.5, lng: -75.7 },    // outside
    ];
    const result = stripPrivacyMedia(photos, zone);
    expect(result[0].lat).toBeUndefined();
    expect(result[0].lng).toBeUndefined();
    expect(result[1].lat).toBe(45.5);
  });
});
