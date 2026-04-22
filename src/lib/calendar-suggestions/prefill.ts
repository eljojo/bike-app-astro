import type { ParsedVEvent } from './types';

/**
 * Build the copyData object the new-event form accepts, from a parsed ICS VEvent.
 * Used by the `?from_feed=<slug>&uid=<ics_uid>` branch in event-new.astro.
 */
export function buildCopyDataFromVevent(v: ParsedVEvent, organizerSlug: string): Record<string, unknown> {
  const startDate = v.start.slice(0, 10);                  // 'YYYY-MM-DD'
  const startTime = v.start.length > 10 ? v.start.slice(11, 16) : undefined;  // 'HH:MM' or undef
  const endDate = v.end ? v.end.slice(0, 10) : undefined;
  const endTime = v.end && v.end.length > 10 ? v.end.slice(11, 16) : undefined;
  const base: Record<string, unknown> = {
    name: v.summary,
    start_date: v.series?.season_start ?? startDate,
    start_time: startTime,
    end_date: endDate,
    end_time: endTime,
    location: v.location,
    body: v.description,
    event_url: v.url,
    organizer: organizerSlug,
    ics_uid: v.uid,
  };
  if (!v.series) return base;
  const series = v.series.kind === 'recurrence'
    ? {
        recurrence: v.series.recurrence,
        recurrence_day: v.series.recurrence_day,
        season_start: v.series.season_start,
        season_end: v.series.season_end,
        skip_dates: v.series.skip_dates,
        overrides: v.series.overrides,
      }
    : { schedule: v.series.schedule };
  return { ...base, series };
}
