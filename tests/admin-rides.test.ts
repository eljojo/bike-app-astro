import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Create a temp fixture directory for this test
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-rides-test-'));

vi.stubEnv('CITY', 'blog');
vi.stubEnv('CONTENT_DIR', tmpDir);

// The admin-rides loader imports city-config which caches. Clear the module cache first.
let loadAdminRideData: typeof import('../src/loaders/admin-rides').loadAdminRideData;

beforeAll(async () => {
  // Create fixture files
  const cityDir = path.join(tmpDir, 'blog');
  const ridesDir = path.join(cityDir, 'rides');

  // Winter ride (standalone, 2026-01-23, CA)
  const winterDir = path.join(ridesDir, '2026', '01');
  fs.mkdirSync(winterDir, { recursive: true });

  fs.writeFileSync(
    path.join(winterDir, '23-winter-ride.gpx'),
    `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">
  <trk>
    <name>Winter Ride</name>
    <trkseg>
      <trkpt lat="45.3485" lon="-75.8154"><ele>64</ele><time>2026-01-23T14:30:00Z</time></trkpt>
      <trkpt lat="45.3600" lon="-75.8300"><ele>70</ele><time>2026-01-23T14:45:00Z</time></trkpt>
      <trkpt lat="45.3700" lon="-75.8500"><ele>75</ele><time>2026-01-23T15:00:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`
  );

  fs.writeFileSync(
    path.join(winterDir, '23-winter-ride.md'),
    `---
name: Winter Ride on the Canal
status: published
ride_date: "2026-01-23"
country: CA
highlight: true
---

A cold but beautiful ride along the frozen canal.`
  );

  // Tour rides (test-tour, 2025-09-09 and 2025-09-10, NL)
  const tourDir = path.join(ridesDir, '2025', '09', 'test-tour');
  fs.mkdirSync(tourDir, { recursive: true });

  fs.writeFileSync(
    path.join(tourDir, 'index.md'),
    `---
name: "Euro Bike Trip"
country: NL
---

A two-day cycling tour through the Netherlands.`
  );

  fs.writeFileSync(
    path.join(tourDir, '09-day-one.gpx'),
    `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test">
  <trk>
    <name>Day One</name>
    <trkseg>
      <trkpt lat="52.3676" lon="4.9041"><ele>2</ele><time>2025-09-09T08:00:00Z</time></trkpt>
      <trkpt lat="52.3776" lon="4.9141"><ele>3</ele><time>2025-09-09T08:30:00Z</time></trkpt>
      <trkpt lat="52.3876" lon="4.9241"><ele>1</ele><time>2025-09-09T09:00:00Z</time></trkpt>
      <trkpt lat="52.3976" lon="4.9341"><ele>2</ele><time>2025-09-09T09:30:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`
  );

  fs.writeFileSync(
    path.join(tourDir, '10-day-two.gpx'),
    `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test">
  <trk>
    <name>Day Two</name>
    <trkseg>
      <trkpt lat="52.0907" lon="5.1214"><ele>5</ele><time>2025-09-10T09:00:00Z</time></trkpt>
      <trkpt lat="52.1007" lon="5.1314"><ele>8</ele><time>2025-09-10T09:20:00Z</time></trkpt>
      <trkpt lat="52.1107" lon="5.1414"><ele>4</ele><time>2025-09-10T09:40:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`
  );

  const mod = await import('../src/loaders/admin-rides');
  loadAdminRideData = mod.loadAdminRideData;
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadAdminRideData', () => {
  it('returns rides sorted by date descending', async () => {
    const { rides } = await loadAdminRideData();
    expect(rides.length).toBe(3);
    const dates = rides.map(r => r.date);
    const sorted = [...dates].sort((a, b) => b.localeCompare(a));
    expect(dates).toEqual(sorted);
  });

  it('has correct shape for each ride', async () => {
    const { rides } = await loadAdminRideData();
    for (const ride of rides) {
      expect(typeof ride.slug).toBe('string');
      expect(typeof ride.name).toBe('string');
      expect(typeof ride.date).toBe('string');
      expect(typeof ride.distance_km).toBe('number');
      expect(typeof ride.elevation_m).toBe('number');
      expect(typeof ride.contentHash).toBe('string');
      expect(ride.contentHash.length).toBe(32);
    }
  });

  it('detects tour membership on rides', async () => {
    const { rides } = await loadAdminRideData();
    const tourRides = rides.filter(r => r.tour_slug);
    expect(tourRides.length).toBe(2);
    for (const r of tourRides) {
      expect(r.tour_slug).toBe('test-tour');
    }
  });

  it('returns ride details keyed by slug', async () => {
    const { details } = await loadAdminRideData();
    expect(Object.keys(details).length).toBe(3);
    for (const [slug, detail] of Object.entries(details)) {
      expect(detail.slug).toBe(slug);
      expect(typeof detail.name).toBe('string');
      expect(typeof detail.body).toBe('string');
      expect(Array.isArray(detail.variants)).toBe(true);
      expect(detail.variants.length).toBe(1);
    }
  });

  it('populates ride-specific fields in details', async () => {
    const { details } = await loadAdminRideData();
    const winterSlug = '2026-01-23-winter-ride';
    const winter = details[winterSlug];
    expect(winter).toBeDefined();
    expect(winter.ride_date).toBe('2026-01-23');
    expect(winter.country).toBe('CA');
    expect(winter.highlight).toBe(true);
  });
});

describe('loadAdminRideData tours', () => {
  it('detects tours from directory structure', async () => {
    const { tours } = await loadAdminRideData();
    expect(tours.length).toBe(1);
    expect(tours[0].slug).toBe('test-tour');
  });

  it('aggregates tour data correctly', async () => {
    const { tours } = await loadAdminRideData();
    const tour = tours[0];
    expect(tour.name).toBe('Euro Bike Trip');
    expect(tour.ride_count).toBe(2);
    expect(tour.days).toBe(2);
    expect(tour.rides.length).toBe(2);
    expect(tour.total_distance_km).toBeGreaterThan(0);
    expect(tour.total_elevation_m).toBeGreaterThanOrEqual(0);
    expect(tour.start_date).toBe('2025-09-09');
    expect(tour.end_date).toBe('2025-09-10');
    expect(tour.countries).toEqual(['NL']);
  });

  it('includes tour description from index.md body', async () => {
    const { tours } = await loadAdminRideData();
    const tour = tours[0];
    expect(tour.description).toContain('two-day cycling tour');
  });
});

describe('loadAdminRideData stats', () => {
  it('computes total stats', async () => {
    const { stats } = await loadAdminRideData();
    expect(stats.total_rides).toBe(3);
    expect(stats.total_tours).toBe(1);
    expect(stats.total_distance_km).toBeGreaterThan(0);
    expect(stats.total_days).toBe(3); // 3 unique dates
    expect(stats.countries.length).toBeGreaterThan(0);
  });

  it('breaks down stats by year', async () => {
    const { stats } = await loadAdminRideData();
    expect(stats.by_year['2025']).toBeDefined();
    expect(stats.by_year['2025'].rides).toBe(2);
    expect(stats.by_year['2026']).toBeDefined();
    expect(stats.by_year['2026'].rides).toBe(1);
  });

  it('breaks down stats by country', async () => {
    const { stats } = await loadAdminRideData();
    expect(stats.by_country['NL']).toBeDefined();
    expect(stats.by_country['NL'].rides).toBe(2);
    expect(stats.by_country['CA']).toBeDefined();
    expect(stats.by_country['CA'].rides).toBe(1);
  });

  it('computes records', async () => {
    const { stats } = await loadAdminRideData();
    expect(stats.records.longest_ride).toBeDefined();
    expect(stats.records.longest_ride!.distance_km).toBeGreaterThan(0);
    expect(stats.records.longest_tour).toBeDefined();
    expect(stats.records.longest_tour!.slug).toBe('test-tour');
  });
});
