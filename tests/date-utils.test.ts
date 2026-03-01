import { describe, it, expect } from 'vitest';
import { parseLocalDate, formatDate, formatDateRange, formatMonthName } from '../src/lib/date-utils';

describe('parseLocalDate', () => {
  it('parses date-only string without timezone shift', () => {
    const d = parseLocalDate('2025-05-03');
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(4); // 0-indexed
    expect(d.getDate()).toBe(3);
  });

  it('handles single-digit months and days', () => {
    const d = parseLocalDate('2025-01-05');
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(5);
  });
});

describe('formatDate', () => {
  it('formats as "Month Day, Year"', () => {
    expect(formatDate(parseLocalDate('2025-05-03'))).toBe('May 3, 2025');
  });
  it('formats as "Month Day" when year omitted', () => {
    expect(formatDate(parseLocalDate('2025-05-03'), { includeYear: false })).toBe('May 3');
  });
});

describe('formatDateRange', () => {
  it('returns single date for same start/end', () => {
    expect(formatDateRange('2025-05-03', '2025-05-03')).toBe('May 3, 2025');
  });
  it('shows compact same-month range', () => {
    expect(formatDateRange('2025-05-23', '2025-05-25')).toBe('May 23 - 25, 2025');
  });
  it('shows full cross-month range', () => {
    expect(formatDateRange('2025-06-21', '2025-07-02')).toBe('June 21 - July 2, 2025');
  });
  it('returns single date when no end_date', () => {
    expect(formatDateRange('2025-05-03')).toBe('May 3, 2025');
  });
});

describe('formatMonthName', () => {
  it('returns full month name for a date string', () => {
    expect(formatMonthName('2025-05-03')).toBe('May');
  });
  it('returns correct month for January', () => {
    expect(formatMonthName('2025-01-15')).toBe('January');
  });
});
