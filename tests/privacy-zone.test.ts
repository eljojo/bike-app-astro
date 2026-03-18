import { describe, it, expect } from 'vitest';
import { filterPrivacyZone, filterPrivacyZones, stripPrivacyMedia, stripPrivacyMediaMulti, computeDynamicZones } from '../src/lib/geo/privacy-zone';

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

describe('filterPrivacyZones (multi-zone)', () => {
  it('filters points inside any of multiple zones', () => {
    const zones = [
      { lat: 45.4, lng: -75.7, radius_m: 500 },
      { lat: 45.5, lng: -75.6, radius_m: 500 },
    ];
    const points = [
      { lat: 45.4, lng: -75.7, ele: 60 },     // inside zone 1
      { lat: 45.45, lng: -75.65, ele: 65 },    // outside both
      { lat: 45.5, lng: -75.6, ele: 70 },      // inside zone 2
    ];
    const result = filterPrivacyZones(points, zones);
    expect(result).toHaveLength(1);
    expect(result[0].lat).toBe(45.45);
  });

  it('returns all points when zones list is empty', () => {
    const points = [
      { lat: 45.4, lng: -75.7, ele: 60 },
      { lat: 45.5, lng: -75.7, ele: 65 },
    ];
    expect(filterPrivacyZones(points, [])).toHaveLength(2);
  });
});

describe('stripPrivacyMediaMulti', () => {
  it('strips coordinates inside any zone', () => {
    const zones = [
      { lat: 45.4, lng: -75.7, radius_m: 500 },
      { lat: 45.5, lng: -75.6, radius_m: 500 },
    ];
    const photos = [
      { key: 'a', lat: 45.4, lng: -75.7 },     // inside zone 1
      { key: 'b', lat: 45.45, lng: -75.65 },    // outside both
      { key: 'c', lat: 45.5, lng: -75.6 },      // inside zone 2
    ];
    const result = stripPrivacyMediaMulti(photos, zones);
    expect(result[0].lat).toBeUndefined();
    expect(result[1].lat).toBe(45.45);
    expect(result[2].lat).toBeUndefined();
  });
});

describe('computeDynamicZones', () => {
  it('creates a zone around the start of a round-trip ride', () => {
    // Round trip: start and end are near the same point
    const points = [
      { lat: 45.4215, lng: -75.6972 },  // start (home)
      { lat: 45.4300, lng: -75.6900 },  // riding out
      { lat: 45.4500, lng: -75.6500 },  // far away
      { lat: 45.4300, lng: -75.6900 },  // riding back
      { lat: 45.4216, lng: -75.6973 },  // end (home again)
    ];
    const zones = computeDynamicZones(points, 'test-ride');
    // Round trip: start ≈ end, so only one zone
    expect(zones).toHaveLength(1);
    expect(zones[0].lat).toBe(45.4215);
    expect(zones[0].lng).toBe(-75.6972);
    expect(zones[0].radius_m).toBeGreaterThan(300);
    expect(zones[0].radius_m).toBeLessThan(700);
  });

  it('creates zones at both ends for one-way rides', () => {
    // One-way: start and end are far apart
    const points = [
      { lat: 45.4215, lng: -75.6972 },  // start
      { lat: 45.4500, lng: -75.6500 },  // middle
      { lat: 45.5000, lng: -75.5000 },  // end (different location)
    ];
    const zones = computeDynamicZones(points, 'test-ride');
    expect(zones).toHaveLength(2);
    expect(zones[0].lat).toBe(45.4215);
    expect(zones[1].lat).toBe(45.5000);
  });

  it('returns empty for empty points', () => {
    expect(computeDynamicZones([], 'test')).toHaveLength(0);
  });

  it('produces deterministic but different radii per ride slug', () => {
    const points = [
      { lat: 45.4215, lng: -75.6972 },
      { lat: 45.4500, lng: -75.6500 },
    ];
    const zones1 = computeDynamicZones(points, 'ride-a');
    const zones2 = computeDynamicZones(points, 'ride-b');
    const zones1Again = computeDynamicZones(points, 'ride-a');
    // Same slug produces same radius (deterministic)
    expect(zones1[0].radius_m).toBe(zones1Again[0].radius_m);
    // Different slugs produce different radii (anti-triangulation)
    expect(zones1[0].radius_m).not.toBe(zones2[0].radius_m);
  });

  it('filters mid-ride passes through the start zone', () => {
    // Ride leaves home, comes back to grab something, leaves again
    const home = { lat: 45.4215, lng: -75.6972 };
    const points = [
      home,                                      // start at home
      { lat: 45.4220, lng: -75.6960 },           // leave (still in zone)
      { lat: 45.4350, lng: -75.6800 },           // out riding (~1.5km away)
      { lat: 45.4400, lng: -75.6700 },           // further out
      { lat: 45.4220, lng: -75.6960 },           // come back (in zone)
      home,                                      // at home
      { lat: 45.4220, lng: -75.6960 },           // leave again (in zone)
      { lat: 45.4350, lng: -75.6800 },           // out again
      { lat: 45.4500, lng: -75.6500 },           // far out
      { lat: 45.4350, lng: -75.6800 },           // returning
      { lat: 45.4220, lng: -75.6960 },           // back in zone
      home,                                      // end at home
    ];
    const zones = computeDynamicZones(points, 'test-ride');
    const filtered = filterPrivacyZones(points, zones);
    // All points near home should be removed, only the far-away points remain
    for (const p of filtered) {
      const distFromHome = Math.sqrt(
        (p.lat - home.lat) ** 2 + (p.lng - home.lng) ** 2,
      );
      // Roughly: 0.001° ≈ 111m, so 0.003° ≈ 333m — should be outside 350m+ zone
      expect(distFromHome).toBeGreaterThan(0.003);
    }
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.length).toBeLessThan(points.length);
  });

  it('respects custom radius and jitter options', () => {
    const points = [
      { lat: 45.4215, lng: -75.6972 },
      { lat: 45.4500, lng: -75.6500 },
    ];
    const zones = computeDynamicZones(points, 'test', { radius_m: 1000, jitter_m: 0 });
    expect(zones[0].radius_m).toBe(1000);
  });

  it('single-point ride produces one zone', () => {
    const points = [{ lat: 45.4215, lng: -75.6972 }];
    const zones = computeDynamicZones(points, 'single');
    expect(zones).toHaveLength(1);
    expect(zones[0].lat).toBe(45.4215);
  });

  it('jittered radius stays within reasonable bounds across many seeds', () => {
    const points = [
      { lat: 45.4215, lng: -75.6972 },
      { lat: 45.4500, lng: -75.6500 },
    ];
    // Test 100 different slugs — radius should always be in [350, 650]
    for (let i = 0; i < 100; i++) {
      const zones = computeDynamicZones(points, `ride-${i}`);
      expect(zones[0].radius_m).toBeGreaterThanOrEqual(350);
      expect(zones[0].radius_m).toBeLessThanOrEqual(650);
    }
  });

  it('short ride entirely within zone radius returns empty after filtering', () => {
    // A ride that goes only ~100m from start and back
    const points = [
      { lat: 45.4215, lng: -75.6972 },
      { lat: 45.4216, lng: -75.6971 },
      { lat: 45.4217, lng: -75.6970 },
      { lat: 45.4216, lng: -75.6971 },
      { lat: 45.4215, lng: -75.6972 },
    ];
    const zones = computeDynamicZones(points, 'short-ride');
    const filtered = filterPrivacyZones(points, zones);
    // All points are within ~500m of start, so everything gets filtered
    expect(filtered).toHaveLength(0);
  });
});

describe('dynamic privacy zones — the blog regression scenario', () => {
  // This is the exact scenario that was broken: privacy_zone: true on a ride
  // but NO lat/lng configured in the city config. The dynamic zone should
  // derive from the ride's own start/end points.
  it('filters ride start/end without any config coordinates', () => {
    const home = { lat: 45.4215, lng: -75.6972 };
    // Simulate a typical round-trip ride
    const points = [
      home,
      { lat: 45.4220, lng: -75.6960 },   // ~130m from home
      { lat: 45.4240, lng: -75.6940 },   // ~370m from home
      { lat: 45.4280, lng: -75.6900 },   // ~770m from home
      { lat: 45.4350, lng: -75.6800 },   // ~2km from home
      { lat: 45.4500, lng: -75.6500 },   // ~5km from home
      { lat: 45.4350, lng: -75.6800 },   // returning
      { lat: 45.4280, lng: -75.6900 },   // ~770m from home
      { lat: 45.4240, lng: -75.6940 },   // ~370m from home
      { lat: 45.4220, lng: -75.6960 },   // ~130m from home
      home,
    ];

    // No config at all — dynamic zones only
    const zones = computeDynamicZones(points, '2026-03-09-first-ride-of-the-year');
    expect(zones.length).toBeGreaterThan(0);

    const filtered = filterPrivacyZones(points, zones);

    // The first and last points (near home) should be gone
    expect(filtered.length).toBeLessThan(points.length);
    expect(filtered.length).toBeGreaterThan(0);

    // No remaining point should be within 350m of home (minimum jittered radius)
    for (const p of filtered) {
      // Use haversine-like check: at lat 45°, 1° lat ≈ 111km, 1° lng ≈ 78km
      const dLat = (p.lat - home.lat) * 111000;
      const dLng = (p.lng - home.lng) * 78000;
      const distM = Math.sqrt(dLat * dLat + dLng * dLng);
      expect(distM).toBeGreaterThan(300);
    }
  });

  it('combines static config zone with dynamic zones', () => {
    // Config has a zone for workplace, dynamic zone covers home
    const workplace = { lat: 45.42, lng: -75.70, radius_m: 300 };
    const homeStart = { lat: 45.45, lng: -75.65 };
    const points = [
      homeStart,                                    // home
      { lat: 45.4510, lng: -75.6490 },              // leaving home
      { lat: 45.4550, lng: -75.6450 },              // outside home zone
      { lat: 45.4400, lng: -75.6600 },              // mid-ride
      { lat: 45.4210, lng: -75.7010 },              // near workplace (~200m)
      { lat: 45.4200, lng: -75.7000 },              // at workplace
      { lat: 45.4400, lng: -75.6600 },              // leaving workplace
      { lat: 45.4550, lng: -75.6450 },              // heading home
      { lat: 45.4510, lng: -75.6490 },              // near home
      homeStart,                                    // home
    ];

    const dynamicZones = computeDynamicZones(
      points.map(p => ({ lat: p.lat, lng: p.lng })),
      'commute-ride',
    );
    const allZones = [workplace, ...dynamicZones];
    const filtered = filterPrivacyZones(
      points.map(p => ({ lat: p.lat, lng: p.lng })),
      allZones,
    );

    // Points near home AND near workplace should both be removed
    for (const p of filtered) {
      const dLatHome = (p.lat - homeStart.lat) * 111000;
      const dLngHome = (p.lng - homeStart.lng) * 78000;
      const distHome = Math.sqrt(dLatHome * dLatHome + dLngHome * dLngHome);
      // Should not be within 300m of home (min jittered radius)
      expect(distHome).toBeGreaterThan(300);
    }
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.length).toBeLessThan(points.length);
  });
});

describe('stripPrivacyMediaMulti edge cases', () => {
  it('does not mutate input array', () => {
    const zones = [{ lat: 45.4, lng: -75.7, radius_m: 500 }];
    const photos = [{ key: 'a', lat: 45.4, lng: -75.7 }];
    const original = { ...photos[0] };
    stripPrivacyMediaMulti(photos, zones);
    expect(photos[0].lat).toBe(original.lat);
    expect(photos[0].lng).toBe(original.lng);
  });

  it('returns photos unchanged when zones list is empty', () => {
    const photos = [{ key: 'a', lat: 45.4, lng: -75.7 }];
    const result = stripPrivacyMediaMulti(photos, []);
    expect(result[0].lat).toBe(45.4);
  });

  it('strips media near ride start using dynamic zones', () => {
    // Photo taken at the start of a ride (near home) should be stripped
    const ridePoints = [
      { lat: 45.4215, lng: -75.6972 },   // start
      { lat: 45.4500, lng: -75.6500 },   // far away
      { lat: 45.4215, lng: -75.6972 },   // end
    ];
    const zones = computeDynamicZones(ridePoints, 'photo-ride');
    const media = [
      { key: 'home-selfie.jpg', lat: 45.4216, lng: -75.6971 },   // at home (~15m)
      { key: 'river-view.jpg', lat: 45.4500, lng: -75.6500 },    // far away
    ];
    const result = stripPrivacyMediaMulti(media, zones);
    expect(result[0].lat).toBeUndefined();
    expect(result[0].lng).toBeUndefined();
    expect(result[0].key).toBe('home-selfie.jpg');
    expect(result[1].lat).toBe(45.4500);
    expect(result[1].key).toBe('river-view.jpg');
  });
});
