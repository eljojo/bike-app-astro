import { NodeHtmlMarkdown } from 'node-html-markdown';
import type { ParsedVEvent } from './types';

// Extract a route-mapping URL out of free-form description text. Today this
// catches RidewithGPS only — the feeds we see in production overwhelmingly
// link there. Add more hosts (Komoot, Strava routes, etc.) when a feed in
// the wild needs them.
const RWGPS_URL_RE = /https?:\/\/(?:www\.)?ridewithgps\.com\/[^\s<>"]+/i;

// Calendar feeds frequently emit description as HTML (Google Calendar /
// Outlook). Plain text passes through unchanged, so we run unconditionally.
const htmlConverter = new NodeHtmlMarkdown();

/**
 * Build the copyData object the new-event form accepts, from a parsed ICS VEvent.
 * Used by the `?from_feed=<slug>&uid=<ics_uid>` branch in event-new.astro.
 */
export function buildCopyDataFromVevent(v: ParsedVEvent, organizerSlug: string): Record<string, unknown> {
  const startDate = v.start.slice(0, 10);                  // 'YYYY-MM-DD'
  const startTime = v.start.length > 10 ? v.start.slice(11, 16) : undefined;  // 'HH:MM' or undef
  const endDate = v.end ? v.end.slice(0, 10) : undefined;
  const endTime = v.end && v.end.length > 10 ? v.end.slice(11, 16) : undefined;
  const mapUrl = v.description?.match(RWGPS_URL_RE)?.[0];
  const body = v.description ? htmlConverter.translate(v.description) : v.description;
  const base: Record<string, unknown> = {
    name: v.summary,
    start_date: v.series?.season_start ?? startDate,
    start_time: startTime,
    end_date: endDate,
    end_time: endTime,
    location: v.location,
    body,
    event_url: v.url,
    organizer: organizerSlug,
    ics_uid: v.uid,
    ...(v.registration_url && { registration_url: v.registration_url }),
    ...(mapUrl && { map_url: mapUrl }),
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
