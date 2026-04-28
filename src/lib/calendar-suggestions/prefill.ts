import { NodeHtmlMarkdown } from 'node-html-markdown';
import type { ParsedFeed, ParsedVEvent } from './types';

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

/**
 * Find the VEvent matching `icsUid` for prefill. After Task 8 dissolves a
 * cluster into one-offs, the suggestion's uid lives inside
 * `feed.events[i].series.overrides[].uid` — never as a top-level uid. A
 * naive `feed.events.find(e => e.uid === icsUid)` misses it and the admin
 * sees "no longer in source calendar". This walks both shapes:
 *
 *   - Top-level event uid (one-off, RRULE series, cluster master).
 *   - Cluster override uid → synthesize a one-off ParsedVEvent from the
 *     override row + master fallback (location/description/url) so prefill
 *     can copy from it as if it were a real one-off VEvent.
 *
 * Cancelled-skip override rows are not real source VEvents and never match.
 */
export function findVeventForPrefill(feed: ParsedFeed, icsUid: string): ParsedVEvent | undefined {
  const top = feed.events.find(e => e.uid === icsUid);
  if (top) return top;
  for (const e of feed.events) {
    const ovr = e.series?.overrides?.find(o => o.uid === icsUid);
    if (ovr && !ovr.cancelled) {
      const masterTime = e.start.length > 10 ? e.start.slice(11) : '00:00:00';
      return {
        uid: icsUid,
        summary: e.summary,
        start: ovr.start_time ? `${ovr.date}T${ovr.start_time}:00` : `${ovr.date}T${masterTime}`,
        location: ovr.location ?? e.location,
        description: ovr.note ?? e.description,
        url: ovr.event_url ?? e.url,
        registration_url: ovr.registration_url ?? e.registration_url,
      };
    }
  }
  return undefined;
}
