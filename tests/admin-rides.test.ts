import { describe, it, expect, vi, beforeAll } from 'vitest';

// Point to jose blog fixtures
vi.stubEnv('CITY', 'jose');
vi.stubEnv('CONTENT_DIR', '.data/e2e-content');

// The admin-rides loader imports city-config which caches. Clear the module cache first.
let loadAdminRideData: typeof import('../src/loaders/admin-rides').loadAdminRideData;

beforeAll(async () => {
  const mod = await import('../src/loaders/admin-rides');
  loadAdminRideData = mod.loadAdminRideData;
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
    const winterSlug = 'winter-ride';
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
