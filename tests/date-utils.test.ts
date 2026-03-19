import { describe, it, expect } from 'vitest';
import { parseLocalDate, formatDate, formatDateRange, formatMonthName, formatAdminDate, formatAdminDateTime, formatDurationLoose, formatIsoDuration } from '../src/lib/date-utils';

describe('parseLocalDate', () => {
  it('parses date-only string without timezone shift', () => {
    const d = parseLocalDate('2025-05-03');
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(4);
    expect(d.getDate()).toBe(3);
  });

  it('handles single-digit months and days', () => {
    const d = parseLocalDate('2025-01-05');
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(5);
  });
});

describe('formatDate', () => {
  it('formats in English Canadian by default', () => {
    expect(formatDate(parseLocalDate('2025-05-03'))).toBe('May 3, 2025');
  });

  it('formats in French Canadian', () => {
    expect(formatDate(parseLocalDate('2025-05-03'), { locale: 'fr-CA' })).toBe('3 mai 2025');
  });

  it('formats without year', () => {
    expect(formatDate(parseLocalDate('2025-05-03'), { includeYear: false })).toBe('May 3');
  });

  it('formats without year in French', () => {
    expect(formatDate(parseLocalDate('2025-05-03'), { includeYear: false, locale: 'fr-CA' })).toBe('3 mai');
  });

  it('formats dates in Spanish (day before month)', () => {
    const d = parseLocalDate('2026-06-15');
    const result = formatDate(d, { locale: 'es-CL' });
    // Spanish uses "15 junio 2026" (day before month), not "junio 15, 2026"
    expect(result).toMatch(/^15\s/);
  });

  it('formats without year in Spanish', () => {
    const result = formatDate(parseLocalDate('2026-06-15'), { includeYear: false, locale: 'es-CL' });
    expect(result).toMatch(/^15\s/);
    expect(result).not.toContain('2026');
  });
});

describe('formatDateRange', () => {
  it('returns single date for same start/end', () => {
    expect(formatDateRange('2025-05-03', '2025-05-03')).toBe('May 3, 2025');
  });

  it('shows compact same-month range', () => {
    expect(formatDateRange('2025-05-23', '2025-05-25')).toBe('May 23 – 25, 2025');
  });

  it('shows full cross-month range', () => {
    expect(formatDateRange('2025-06-21', '2025-07-02')).toBe('June 21 – July 2, 2025');
  });

  it('returns single date when no end_date', () => {
    expect(formatDateRange('2025-05-03')).toBe('May 3, 2025');
  });

  it('formats same-month range in French', () => {
    expect(formatDateRange('2025-05-23', '2025-05-25', 'fr-CA')).toBe('23 – 25 mai 2025');
  });

  it('formats cross-month range in French', () => {
    expect(formatDateRange('2025-06-21', '2025-07-02', 'fr-CA')).toBe('21 juin – 2 juillet 2025');
  });

  it('formats same-month range in Spanish', () => {
    const result = formatDateRange('2026-06-15', '2026-06-20', 'es-CL');
    // Spanish: "15 – 20 junio 2026" (day before month)
    expect(result).toMatch(/^15\s/);
  });

  it('formats cross-month range in Spanish', () => {
    const result = formatDateRange('2026-06-21', '2026-07-02', 'es-CL');
    // Spanish: "21 junio – 2 julio 2026"
    expect(result).toMatch(/^21\s/);
  });
});

describe('formatMonthName', () => {
  it('returns English month name with year by default', () => {
    expect(formatMonthName('2025-05-03')).toBe('May 2025');
  });

  it('returns French month name with year', () => {
    expect(formatMonthName('2025-05-03', 'fr-CA')).toBe('mai 2025');
  });

  it('distinguishes same month in different years', () => {
    expect(formatMonthName('2026-01-15')).not.toBe(formatMonthName('2027-01-15'));
  });
});

describe('formatAdminDate', () => {
  it('formats ISO string as short date', () => {
    const result = formatAdminDate('2025-06-15T10:30:00Z');
    expect(result).toContain('Jun');
    expect(result).toContain('15');
    expect(result).toContain('2025');
  });
});

describe('formatAdminDateTime', () => {
  it('formats ISO string as short date with time', () => {
    const result = formatAdminDateTime('2025-06-15T10:30:00Z');
    expect(result).toContain('Jun');
    expect(result).toContain('15');
    expect(result).toContain('2025');
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe('formatDurationLoose', () => {
  it('formats hours and minutes with space', () => {
    expect(formatDurationLoose(7500)).toBe('2h 5m');
  });
  it('formats minutes only when under an hour', () => {
    expect(formatDurationLoose(300)).toBe('5m');
  });
  it('formats zero minutes', () => {
    expect(formatDurationLoose(0)).toBe('0m');
  });
});

describe('formatIsoDuration', () => {
  it('formats full HMS duration', () => {
    expect(formatIsoDuration('PT1H5M30S')).toBe('1:05:30');
  });
  it('formats minutes and seconds only', () => {
    expect(formatIsoDuration('PT5M30S')).toBe('5:30');
  });
  it('formats hours and minutes without seconds', () => {
    expect(formatIsoDuration('PT2H10M')).toBe('2:10:00');
  });
  it('returns empty string for invalid input', () => {
    expect(formatIsoDuration('garbage')).toBe('');
  });
});
