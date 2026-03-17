import { describe, it, expect } from 'vitest';
import { extractDateFromPath, detectTours, buildSlug, adjustTourYears } from '../src/loaders/rides';

describe('extractDateFromPath', () => {
  it('extracts date from YYYY/MM/DD-name.gpx', () => {
    const result = extractDateFromPath('2026/01/23-winter-ride.gpx');
    expect(result).toEqual({ year: 2026, month: 1, day: 23 });
  });

  it('extracts date from YYYY/MM/tour-name/DD-name.gpx', () => {
    const result = extractDateFromPath('2025/09/euro-bike-trip/09-amsterdam.gpx');
    expect(result).toEqual({ year: 2025, month: 9, day: 9 });
  });

  it('extracts date from YYYY/tour-name/MM-DD-name.gpx (multi-month tour)', () => {
    const result = extractDateFromPath('2023/long-tour/01-23-first-day.gpx');
    expect(result).toEqual({ year: 2023, month: 1, day: 23 });
  });

  it('extracts date from YYYY/year-prefixed-tour/MM-DD-name.gpx', () => {
    const result = extractDateFromPath('2025/2025-eurobiketrip/09-09-schiphol.gpx');
    expect(result).toEqual({ year: 2025, month: 9, day: 9 });
  });

  it('handles single-digit day', () => {
    const result = extractDateFromPath('2025/06/3-morning-ride.gpx');
    expect(result).toEqual({ year: 2025, month: 6, day: 3 });
  });

  it('handles two-digit month and day in filename', () => {
    const result = extractDateFromPath('2024/grand-tour/11-15-mountain-pass.gpx');
    expect(result).toEqual({ year: 2024, month: 11, day: 15 });
  });

  it('returns null for invalid year', () => {
    expect(extractDateFromPath('abc/01/23-ride.gpx')).toBeNull();
  });

  it('returns null for path with only YYYY/name.gpx (no date info)', () => {
    expect(extractDateFromPath('2026/ride.gpx')).toBeNull();
  });

  it('returns null for file without leading digit prefix', () => {
    // YYYY/MM/name.gpx where name does not start with digits
    expect(extractDateFromPath('2026/01/winter-ride.gpx')).toBeNull();
  });

  it('returns null for month > 12', () => {
    expect(extractDateFromPath('2026/13/01-ride.gpx')).toBeNull();
  });

  it('returns null for day > 31', () => {
    expect(extractDateFromPath('2026/01/32-ride.gpx')).toBeNull();
  });
});

describe('detectTours', () => {
  it('detects a tour directory with multiple GPX files', () => {
    const paths = [
      '2025/09/euro-trip/09-amsterdam.gpx',
      '2025/09/euro-trip/10-utrecht.gpx',
    ];
    const tours = detectTours(paths);
    expect(tours).toHaveLength(1);
    expect(tours[0].slug).toBe('euro-trip');
    expect(tours[0].dirPath).toBe('2025/09/euro-trip');
    expect(tours[0].ridePaths).toHaveLength(2);
  });

  it('detects multi-month tour under YYYY/tour-name/', () => {
    const paths = [
      '2023/long-tour/01-23-first-day.gpx',
      '2023/long-tour/02-15-second-day.gpx',
    ];
    const tours = detectTours(paths);
    expect(tours).toHaveLength(1);
    expect(tours[0].slug).toBe('long-tour');
    expect(tours[0].dirPath).toBe('2023/long-tour');
    expect(tours[0].ridePaths).toHaveLength(2);
  });

  it('detects tour whose name starts with digits (e.g. 2025-eurobiketrip)', () => {
    const paths = [
      '2025/2025-eurobiketrip/09-09-schiphol.gpx',
      '2025/2025-eurobiketrip/09-10-amsterdam.gpx',
    ];
    const tours = detectTours(paths);
    expect(tours).toHaveLength(1);
    expect(tours[0].slug).toBe('2025-eurobiketrip');
    expect(tours[0].dirPath).toBe('2025/2025-eurobiketrip');
    expect(tours[0].ridePaths).toHaveLength(2);
  });

  it('does not treat numeric directories as tours', () => {
    const paths = [
      '2026/01/23-winter-ride.gpx',
      '2026/01/24-another-ride.gpx',
    ];
    const tours = detectTours(paths);
    expect(tours).toHaveLength(0);
  });

  it('separates multiple distinct tours', () => {
    const paths = [
      '2025/09/euro-trip/09-amsterdam.gpx',
      '2025/09/euro-trip/10-utrecht.gpx',
      '2025/07/japan-tour/01-tokyo.gpx',
      '2025/07/japan-tour/02-kyoto.gpx',
      '2026/01/23-solo-ride.gpx',
    ];
    const tours = detectTours(paths);
    expect(tours).toHaveLength(2);

    const slugs = tours.map(t => t.slug).sort();
    expect(slugs).toEqual(['euro-trip', 'japan-tour']);
  });

  it('handles mixed standalone and tour rides', () => {
    const paths = [
      '2026/01/23-winter-ride.gpx',
      '2025/09/test-tour/09-day-one.gpx',
      '2025/09/test-tour/10-day-two.gpx',
    ];
    const tours = detectTours(paths);
    expect(tours).toHaveLength(1);
    expect(tours[0].slug).toBe('test-tour');
    expect(tours[0].ridePaths).toHaveLength(2);
    expect(tours[0].ridePaths).not.toContain('2026/01/23-winter-ride.gpx');
  });
});

describe('buildSlug', () => {
  it('produces date-prefixed slug for standalone rides', () => {
    const date = { year: 2026, month: 1, day: 23 };
    expect(buildSlug(date, '23-winter-ride.gpx')).toBe('2026-01-23-winter-ride');
  });

  it('strips multi-digit day prefix and adds date', () => {
    const date = { year: 2025, month: 5, day: 14 };
    expect(buildSlug(date, '14-wakefield-ride-with-tony.gpx')).toBe('2025-05-14-wakefield-ride-with-tony');
  });

  it('produces name-only slug for tour rides', () => {
    const date = { year: 2023, month: 1, day: 23 };
    expect(buildSlug(date, '01-23-first-day.gpx', true)).toBe('first-day');
  });

  it('preserves numeric handle ID when stripping day prefix', () => {
    const date = { year: 2020, month: 8, day: 31 };
    expect(buildSlug(date, '31-268-afternoon-ride.gpx')).toBe('2020-08-31-268-afternoon-ride');
  });

  it('tour ride with DD- prefix returns name only', () => {
    const date = { year: 2025, month: 9, day: 9 };
    expect(buildSlug(date, '09-amsterdam.gpx', true)).toBe('amsterdam');
  });

  it('strips emoji from slug', () => {
    const date = { year: 2026, month: 1, day: 15 };
    expect(buildSlug(date, '15-🎯-sprint.gpx')).toBe('2026-01-15-sprint');
  });

  it('falls back to date-only for emoji-only filename', () => {
    const date = { year: 2026, month: 1, day: 15 };
    expect(buildSlug(date, '15-🎯.gpx')).toBe('ride-2026-01-15');
  });

  it('transliterates accented characters', () => {
    const date = { year: 2026, month: 1, day: 15 };
    expect(buildSlug(date, '15-café-ride.gpx')).toBe('2026-01-15-cafe-ride');
  });
});

describe('adjustTourYears', () => {
  it('increments year for January rides when tour spans Dec→Jan', () => {
    const dates = [
      { year: 2022, month: 12, day: 13 },
      { year: 2022, month: 12, day: 19 },
      { year: 2022, month: 1, day: 2 },
      { year: 2022, month: 1, day: 7 },
    ];
    adjustTourYears(dates);
    expect(dates[0]).toEqual({ year: 2022, month: 12, day: 13 });
    expect(dates[1]).toEqual({ year: 2022, month: 12, day: 19 });
    expect(dates[2]).toEqual({ year: 2023, month: 1, day: 2 });
    expect(dates[3]).toEqual({ year: 2023, month: 1, day: 7 });
  });

  it('does not adjust single-year tours', () => {
    const dates = [
      { year: 2025, month: 5, day: 1 },
      { year: 2025, month: 6, day: 15 },
      { year: 2025, month: 7, day: 20 },
    ];
    adjustTourYears(dates);
    expect(dates[0].year).toBe(2025);
    expect(dates[1].year).toBe(2025);
    expect(dates[2].year).toBe(2025);
  });

  it('does not adjust when only one ride', () => {
    const dates = [{ year: 2022, month: 1, day: 5 }];
    adjustTourYears(dates);
    expect(dates[0].year).toBe(2022);
  });

  it('handles Oct–Mar tour spanning year boundary', () => {
    const dates = [
      { year: 2024, month: 10, day: 1 },
      { year: 2024, month: 11, day: 15 },
      { year: 2024, month: 12, day: 20 },
      { year: 2024, month: 1, day: 5 },
      { year: 2024, month: 2, day: 10 },
      { year: 2024, month: 3, day: 1 },
    ];
    adjustTourYears(dates);
    expect(dates[0].year).toBe(2024);
    expect(dates[1].year).toBe(2024);
    expect(dates[2].year).toBe(2024);
    expect(dates[3].year).toBe(2025);
    expect(dates[4].year).toBe(2025);
    expect(dates[5].year).toBe(2025);
  });

  it('does not adjust 6-month tour within same year', () => {
    const dates = [
      { year: 2025, month: 1, day: 1 },
      { year: 2025, month: 6, day: 30 },
    ];
    adjustTourYears(dates);
    expect(dates[0].year).toBe(2025);
    expect(dates[1].year).toBe(2025);
  });
});
