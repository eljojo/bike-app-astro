import { describe, it, expect } from 'vitest';
import { generateTourRedirects } from '../src/lib/tour-redirects';

describe('generateTourRedirects', () => {
  it('generates /rides/slug → /tours/tour/slug redirect for tour rides', () => {
    const tours = [
      {
        slug: 'euro-trip',
        dirPath: '2025/09/euro-trip',
        ridePaths: ['2025/09/euro-trip/09-amsterdam.gpx', '2025/09/euro-trip/10-utrecht.gpx'],
      },
    ];
    const lines = generateTourRedirects(tours, [
      { gpxRelPath: '2025/09/euro-trip/09-amsterdam.gpx', slug: 'amsterdam' },
      { gpxRelPath: '2025/09/euro-trip/10-utrecht.gpx', slug: 'utrecht' },
      { gpxRelPath: '2026/01/23-solo-ride.gpx', slug: '2026-01-23-solo-ride' },
    ]);
    expect(lines).toContain('/rides/amsterdam  /tours/euro-trip/amsterdam  301');
    expect(lines).toContain('/rides/amsterdam/map  /tours/euro-trip/amsterdam/map  301');
    expect(lines).toContain('/rides/utrecht  /tours/euro-trip/utrecht  301');
    expect(lines).toContain('/rides/utrecht/map  /tours/euro-trip/utrecht/map  301');
  });

  it('does not generate redirects for standalone rides', () => {
    const tours = [
      {
        slug: 'euro-trip',
        dirPath: '2025/09/euro-trip',
        ridePaths: ['2025/09/euro-trip/09-amsterdam.gpx'],
      },
    ];
    const lines = generateTourRedirects(tours, [
      { gpxRelPath: '2025/09/euro-trip/09-amsterdam.gpx', slug: 'amsterdam' },
      { gpxRelPath: '2026/01/23-solo-ride.gpx', slug: '2026-01-23-solo-ride' },
    ]);
    // No redirect for standalone ride
    expect(lines.some(l => l.includes('solo-ride'))).toBe(false);
  });

  it('deduplicates redirects', () => {
    const tours = [
      {
        slug: 'tour-a',
        dirPath: '2025/09/tour-a',
        ridePaths: ['2025/09/tour-a/09-day-1.gpx', '2025/09/tour-a/10-day-1.gpx'],
      },
    ];
    // Two rides with same slug in same tour
    const lines = generateTourRedirects(tours, [
      { gpxRelPath: '2025/09/tour-a/09-day-1.gpx', slug: 'day-1' },
      { gpxRelPath: '2025/09/tour-a/10-day-1.gpx', slug: 'day-1' },
    ]);
    const matching = lines.filter(l => l === '/rides/day-1  /tours/tour-a/day-1  301');
    expect(matching).toHaveLength(1);
  });

  it('returns empty array when no tours', () => {
    const lines = generateTourRedirects([], [
      { gpxRelPath: '2026/01/23-solo-ride.gpx', slug: '2026-01-23-solo-ride' },
    ]);
    expect(lines).toEqual([]);
  });
});
