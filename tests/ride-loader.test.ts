import { describe, it, expect } from 'vitest';
import { extractDateFromPath, detectTours, buildSlug } from '../src/loaders/rides';

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
  it('produces name-only slug without date prefix', () => {
    const date = { year: 2026, month: 1, day: 23 };
    expect(buildSlug(date, '23-winter-ride.gpx')).toBe('winter-ride');
  });

  it('strips multi-digit day prefix', () => {
    const date = { year: 2025, month: 5, day: 14 };
    expect(buildSlug(date, '14-wakefield-ride-with-tony.gpx')).toBe('wakefield-ride-with-tony');
  });

  it('strips MM-DD prefix for multi-month tours', () => {
    const date = { year: 2023, month: 1, day: 23 };
    expect(buildSlug(date, '01-23-first-day.gpx')).toBe('first-day');
  });

  it('preserves numeric handle ID when stripping day prefix', () => {
    // filename: DD-{handle}.gpx where handle is 268-afternoon-ride (Rails ID-based)
    const date = { year: 2020, month: 8, day: 31 };
    expect(buildSlug(date, '31-268-afternoon-ride.gpx')).toBe('268-afternoon-ride');
  });

  it('preserves handle starting with hyphen', () => {
    const date = { year: 2024, month: 3, day: 14 };
    expect(buildSlug(date, '14--morning-ride.gpx')).toBe('-morning-ride');
  });

  it('preserves 1-digit handle prefix (6-sprints)', () => {
    // DD-{handle} where handle is "6-sprints" — must not strip the "6-"
    const date = { year: 2021, month: 4, day: 14 };
    expect(buildSlug(date, '14-6-sprints.gpx')).toBe('6-sprints');
  });

  it('preserves 2-digit handle prefix (31-the-1250)', () => {
    const date = { year: 2020, month: 11, day: 25 };
    expect(buildSlug(date, '25-31-the-1250.gpx')).toBe('31-the-1250');
  });

  it('preserves 3-digit numeric prefix in handle', () => {
    const date = { year: 2020, month: 7, day: 4 };
    expect(buildSlug(date, '04-292-great-eclipse.gpx')).toBe('292-great-eclipse');
  });

  it('uses handle when provided', () => {
    const date = { year: 2022, month: 6, day: 17 };
    expect(buildSlug(date, '17-day-1.gpx', 'day-1-aachen-to-somewhere-in-belgium'))
      .toBe('day-1-aachen-to-somewhere-in-belgium');
  });

  it('ignores handle when not provided', () => {
    const date = { year: 2025, month: 3, day: 5 };
    expect(buildSlug(date, '05-morning-ride.gpx')).toBe('morning-ride');
  });
});
