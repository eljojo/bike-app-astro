/** Format a Date to YYYY-MM-DD string. Inverse of parseLocalDate. */
export function formatDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parse a date-only ISO string (YYYY-MM-DD) without timezone shift.
 */
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

const monthFirstCache = new Map<string, boolean>();
function isMonthFirst(locale: string): boolean {
  const cached = monthFirstCache.get(locale);
  if (cached !== undefined) return cached;
  const parts = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' }).formatToParts(new Date(2026, 0, 15));
  const result = parts.findIndex(p => p.type === 'month') < parts.findIndex(p => p.type === 'day');
  monthFirstCache.set(locale, result);
  return result;
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

/** Format seconds into a compact duration string like "2h05m". */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h${m.toString().padStart(2, '0')}m`;
}

/** Format seconds as duration with spaces — "2h 5m" or "5m". */
export function formatDurationLoose(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Format ISO 8601 duration (PT1H5M30S) as clock display — "1:05:30" or "5:30". */
export function formatIsoDuration(iso: string): string {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return '';
  const h = parseInt(match[1] || '0');
  const m = parseInt(match[2] || '0');
  const s = parseInt(match[3] || '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Parse a date string to end-of-day (23:59:59.999).
 * Use for "is upcoming" comparisons so today's events aren't treated as past.
 */
export function endOfDay(dateStr: string): Date {
  const d = parseLocalDate(dateStr);
  d.setHours(23, 59, 59, 999);
  return d;
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
