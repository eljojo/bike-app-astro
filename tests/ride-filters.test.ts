import { describe, it, expect } from 'vitest';
import { rideFilters, applyFilter, getYears, getCountries } from '../src/lib/ride-filters';
import type { RideFilterInput } from '../src/lib/ride-filters';

const mockRide = (overrides: Partial<RideFilterInput> = {}): RideFilterInput => ({
  distance_km: 30,
  moving_time_s: 3600,
  average_speed_kmh: 18,
  tour_slug: undefined,
  country: 'CA',
  ride_date: '2026-01-15',
  status: 'published',
  ...overrides,
});

describe('ride filters', () => {
  it('all filter matches everything', () => {
    expect(applyFilter('all', mockRide())).toBe(true);
  });

  it('chill filter matches short slow rides', () => {
    expect(applyFilter('chill', mockRide({ distance_km: 20, moving_time_s: 5400, average_speed_kmh: 15 }))).toBe(true);
  });

  it('chill filter rejects long rides', () => {
    expect(applyFilter('chill', mockRide({ distance_km: 50 }))).toBe(false);
  });

  it('chill filter rejects tour rides', () => {
    expect(applyFilter('chill', mockRide({ distance_km: 20, tour_slug: 'euro-trip' }))).toBe(false);
  });

  it('long filter matches 50km+ rides', () => {
    expect(applyFilter('long', mockRide({ distance_km: 65 }))).toBe(true);
  });

  it('long filter matches 5h+ rides', () => {
    expect(applyFilter('long', mockRide({ distance_km: 30, moving_time_s: 20000 }))).toBe(true);
  });

  it('fast filter matches 22+ km/h', () => {
    expect(applyFilter('fast', mockRide({ average_speed_kmh: 25 }))).toBe(true);
  });

  it('fast filter rejects slow rides', () => {
    expect(applyFilter('fast', mockRide({ average_speed_kmh: 18 }))).toBe(false);
  });

  it('century filter matches 100km+', () => {
    expect(applyFilter('century', mockRide({ distance_km: 110 }))).toBe(true);
  });

  it('century filter rejects shorter rides', () => {
    expect(applyFilter('century', mockRide({ distance_km: 90 }))).toBe(false);
  });

  it('tours filter matches rides with tour_slug', () => {
    expect(applyFilter('tours', mockRide({ tour_slug: 'euro-trip' }))).toBe(true);
  });

  it('tours filter rejects standalone rides', () => {
    expect(applyFilter('tours', mockRide())).toBe(false);
  });

  it('unpublished filter matches drafts', () => {
    expect(applyFilter('unpublished', mockRide({ status: 'draft' }))).toBe(true);
  });

  it('unpublished filter rejects published', () => {
    expect(applyFilter('unpublished', mockRide())).toBe(false);
  });

  it('unknown filter defaults to true', () => {
    expect(applyFilter('nonexistent', mockRide())).toBe(true);
  });

  it('exports filters list', () => {
    expect(rideFilters.length).toBeGreaterThan(0);
    expect(rideFilters[0].id).toBe('all');
  });
});

describe('getYears', () => {
  it('extracts unique years sorted descending', () => {
    const rides = [
      mockRide({ ride_date: '2024-05-01' }),
      mockRide({ ride_date: '2026-01-15' }),
      mockRide({ ride_date: '2024-08-20' }),
    ];
    expect(getYears(rides)).toEqual([2026, 2024]);
  });
});

describe('getCountries', () => {
  it('extracts unique countries sorted', () => {
    const rides = [
      mockRide({ country: 'FR' }),
      mockRide({ country: 'CA' }),
      mockRide({ country: 'FR' }),
    ];
    expect(getCountries(rides)).toEqual(['CA', 'FR']);
  });
});
