import { describe, it, expect } from 'vitest';
import { parseLocalDate, formatDate, formatDateRange, formatMonthName, formatAdminDate, formatAdminDateTime } from '../src/lib/date-utils';

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
});

describe('formatMonthName', () => {
  it('returns English month name by default', () => {
    expect(formatMonthName('2025-05-03')).toBe('May');
  });

  it('returns French month name', () => {
    expect(formatMonthName('2025-05-03', 'fr-CA')).toBe('mai');
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
