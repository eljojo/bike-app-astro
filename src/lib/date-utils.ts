/**
 * Parse a date-only ISO string (YYYY-MM-DD) without timezone shift.
 * new Date('2025-05-03') interprets as UTC midnight, which shifts
 * to the previous day in local time. This avoids that by using
 * the Date(year, month, day) constructor which uses local time.
 */
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function formatDate(d: Date, opts?: { includeYear?: boolean }): string {
  const month = d.toLocaleString('en-US', { month: 'long' });
  const day = d.getDate();
  if (opts?.includeYear === false) return `${month} ${day}`;
  return `${month} ${day}, ${d.getFullYear()}`;
}

export function formatDateRange(startStr: string, endStr?: string): string {
  const start = parseLocalDate(startStr);
  if (!endStr || startStr === endStr) return formatDate(start);

  const end = parseLocalDate(endStr);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const startMonth = start.toLocaleString('en-US', { month: 'long' });
  const endMonth = end.toLocaleString('en-US', { month: 'long' });

  if (sameMonth) {
    return `${startMonth} ${start.getDate()} - ${end.getDate()}, ${start.getFullYear()}`;
  }
  return `${startMonth} ${start.getDate()} - ${endMonth} ${end.getDate()}, ${end.getFullYear()}`;
}

export function formatMonthName(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleString('en-US', { month: 'long' });
}
