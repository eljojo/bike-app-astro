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
  // Conditional spreads so undefined fields don't end up as explicit nulls in
  // the serialized YAML frontmatter.
  let series: Record<string, unknown>;
  if (v.series.kind === 'recurrence') {
    series = {
      ...(v.series.recurrence && { recurrence: v.series.recurrence }),
      ...(v.series.recurrence_day && { recurrence_day: v.series.recurrence_day }),
      ...(v.series.season_start && { season_start: v.series.season_start }),
      ...(v.series.season_end && { season_end: v.series.season_end }),
      ...(v.series.skip_dates && v.series.skip_dates.length > 0 && { skip_dates: v.series.skip_dates }),
      ...(v.series.overrides && v.series.overrides.length > 0 && { overrides: v.series.overrides }),
    };
  } else {
    series = v.series.schedule ? { schedule: v.series.schedule } : {};
  }
  return { ...base, series };
}
