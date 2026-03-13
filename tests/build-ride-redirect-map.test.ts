import { describe, it, expect } from 'vitest';
import { buildRideRedirectMap } from '../src/lib/build-ride-redirect-map';

describe('buildRideRedirectMap', () => {
  it('builds map from ride redirect entries with /map variants', () => {
    const entries = [
      { from: '420-evening-ride', to: '2014-06-23-evening-ride' },
    ];
    const map = buildRideRedirectMap(entries, []);

    expect(map['/rides/420-evening-ride']).toBe('/rides/2014-06-23-evening-ride');
    expect(map['/rides/420-evening-ride/map']).toBe('/rides/2014-06-23-evening-ride/map');
  });

  it('builds map from tour redirect lines', () => {
    const tourLines = [
      '/rides/amsterdam  /tours/euro-trip/amsterdam  301',
      '/rides/amsterdam/map  /tours/euro-trip/amsterdam/map  301',
    ];
    const map = buildRideRedirectMap([], tourLines);

    expect(map['/rides/amsterdam']).toBe('/tours/euro-trip/amsterdam');
    expect(map['/rides/amsterdam/map']).toBe('/tours/euro-trip/amsterdam/map');
  });

  it('merges both sources', () => {
    const entries = [
      { from: 'old-slug', to: '2025-06-15-new-slug' },
    ];
    const tourLines = [
      '/rides/day-1  /tours/summer-tour/day-1  301',
      '/rides/day-1/map  /tours/summer-tour/day-1/map  301',
    ];
    const map = buildRideRedirectMap(entries, tourLines);

    expect(map['/rides/old-slug']).toBe('/rides/2025-06-15-new-slug');
    expect(map['/rides/old-slug/map']).toBe('/rides/2025-06-15-new-slug/map');
    expect(map['/rides/day-1']).toBe('/tours/summer-tour/day-1');
    expect(map['/rides/day-1/map']).toBe('/tours/summer-tour/day-1/map');
  });

  it('returns empty map for empty inputs', () => {
    const map = buildRideRedirectMap([], []);
    expect(map).toEqual({});
  });

  it('tour redirects overwrite ride redirects for same path', () => {
    // If a ride redirect points /rides/day-1 → /rides/2025-01-01-day-1
    // but a tour redirect points /rides/day-1 → /tours/tour/day-1,
    // the tour redirect wins (processed second).
    const entries = [
      { from: 'day-1', to: '2025-01-01-day-1' },
    ];
    const tourLines = [
      '/rides/day-1  /tours/summer-tour/day-1  301',
      '/rides/day-1/map  /tours/summer-tour/day-1/map  301',
    ];
    const map = buildRideRedirectMap(entries, tourLines);

    expect(map['/rides/day-1']).toBe('/tours/summer-tour/day-1');
    expect(map['/rides/day-1/map']).toBe('/tours/summer-tour/day-1/map');
  });

  it('handles multiple ride redirect entries', () => {
    const entries = [
      { from: '420-evening-ride', to: '2014-06-23-evening-ride' },
      { from: '-420-evening-ride', to: '2014-06-23-evening-ride' },
      { from: 'new-bike-first-ride', to: '2020-04-29-new-bike-first-ride' },
    ];
    const map = buildRideRedirectMap(entries, []);

    expect(Object.keys(map)).toHaveLength(6); // 3 entries x 2 (/map variant)
    expect(map['/rides/420-evening-ride']).toBe('/rides/2014-06-23-evening-ride');
    expect(map['/rides/-420-evening-ride']).toBe('/rides/2014-06-23-evening-ride');
    expect(map['/rides/new-bike-first-ride']).toBe('/rides/2020-04-29-new-bike-first-ride');
  });
});
