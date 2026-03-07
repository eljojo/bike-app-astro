/**
 * Parse a date-only ISO string (YYYY-MM-DD) without timezone shift.
 */
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function isMonthFirst(locale: string): boolean {
  const parts = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' }).formatToParts(new Date(2026, 0, 15));
  const monthIdx = parts.findIndex(p => p.type === 'month');
  const dayIdx = parts.findIndex(p => p.type === 'day');
  return monthIdx < dayIdx;
}

export function formatDate(d: Date, opts?: { includeYear?: boolean; locale?: string }): string {
  const loc = opts?.locale || 'en-CA';
  const month = d.toLocaleString(loc, { month: 'long' });
  const day = d.getDate();
  const year = d.getFullYear();

  if (isMonthFirst(loc)) {
    if (opts?.includeYear === false) return `${month} ${day}`;
    return `${month} ${day}, ${year}`;
  }
  if (opts?.includeYear === false) return `${day} ${month}`;
  return `${day} ${month} ${year}`;
}

export function formatDateRange(startStr: string, endStr?: string, locale?: string): string {
  const loc = locale || 'en-CA';
  const start = parseLocalDate(startStr);
  if (!endStr || startStr === endStr) return formatDate(start, { locale: loc });

  const end = parseLocalDate(endStr);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const startMonth = start.toLocaleString(loc, { month: 'long' });
  const endMonth = end.toLocaleString(loc, { month: 'long' });

  if (isMonthFirst(loc)) {
    if (sameMonth) {
      return `${startMonth} ${start.getDate()} \u2013 ${end.getDate()}, ${start.getFullYear()}`;
    }
    return `${startMonth} ${start.getDate()} \u2013 ${endMonth} ${end.getDate()}, ${end.getFullYear()}`;
  }

  if (sameMonth) {
    return `${start.getDate()} \u2013 ${end.getDate()} ${startMonth} ${start.getFullYear()}`;
  }
  return `${start.getDate()} ${startMonth} \u2013 ${end.getDate()} ${endMonth} ${end.getFullYear()}`;
}

export function formatMonthName(dateStr: string, locale?: string): string {
  return parseLocalDate(dateStr).toLocaleString(locale || 'en-CA', { month: 'long' });
}

/** Format an ISO date string for admin UI (no time). */
export function formatAdminDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-CA', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

/** Format an ISO date string for admin UI (with time). */
export function formatAdminDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-CA', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
