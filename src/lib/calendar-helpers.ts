import { endOfDay, formatMonthName, parseLocalDate } from './date-utils';
import { expandSeriesOccurrences, isSeriesEvent } from './series-utils';

export interface CalendarEntry {
  event: { id: string; data: Record<string, unknown> };
  occurrenceDate?: string;
  occurrenceLocation?: string;
}

export function effectiveDate(entry: CalendarEntry): string {
  return entry.occurrenceDate || (entry.event.data.start_date as string);
}

export function effectiveEndDate(entry: CalendarEntry): string {
  return entry.occurrenceDate || (entry.event.data.end_date as string) || (entry.event.data.start_date as string);
}

/** Expand series events into one CalendarEntry per non-cancelled occurrence. */
export function expandEvents(events: CalendarEntry['event'][]): CalendarEntry[] {
  const expanded: CalendarEntry[] = [];
  for (const event of events) {
    if (isSeriesEvent(event.data)) {
      const occurrences = expandSeriesOccurrences(event.data as Parameters<typeof expandSeriesOccurrences>[0]);
      for (const occ of occurrences) {
        if (!occ.cancelled) {
          expanded.push({
            event,
            occurrenceDate: occ.date,
            occurrenceLocation: occ.location,
          });
        }
      }
    } else {
      expanded.push({ event });
    }
  }
  return expanded;
}

/** Deduplicate series so each series event appears once (first occurrence). */
export function deduplicateSeries(entries: CalendarEntry[]): CalendarEntry[] {
  const seen = new Set<string>();
  const result: CalendarEntry[] = [];
  for (const entry of entries) {
    const id = entry.event.id;
    if (isSeriesEvent(entry.event.data)) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    result.push(entry);
  }
  return result;
}

/** Split entries into upcoming and past based on end-of-day comparison. */
export function splitUpcomingPast(entries: CalendarEntry[], now: Date): { upcoming: CalendarEntry[]; past: CalendarEntry[] } {
  const upcoming = entries
    .filter(e => endOfDay(effectiveEndDate(e)) >= now)
    .sort((a, b) => parseLocalDate(effectiveDate(a)).getTime() - parseLocalDate(effectiveDate(b)).getTime());
  const past = entries
    .filter(e => endOfDay(effectiveEndDate(e)) < now)
    .sort((a, b) => parseLocalDate(effectiveDate(b)).getTime() - parseLocalDate(effectiveDate(a)).getTime());
  return { upcoming, past };
}

/** Group entries by month name (includes year to avoid cross-year collisions). */
export function groupByMonth(entries: CalendarEntry[], locale = 'en-CA'): Record<string, CalendarEntry[]> {
  const groups: Record<string, CalendarEntry[]> = {};
  for (const entry of entries) {
    const month = formatMonthName(effectiveDate(entry), locale);
    if (!groups[month]) groups[month] = [];
    groups[month].push(entry);
  }
  return groups;
}
