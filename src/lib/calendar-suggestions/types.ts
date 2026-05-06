// src/lib/calendar-suggestions/types.ts
export interface ParsedFeed {
  fetched_at: string;          // ISO
  source_url: string;
  events: ParsedVEvent[];
}

/**
 * A surfaced import suggestion — the post-filter shape for one-off and series
 * events that have not yet been imported into the repo.
 */
export type ImportSuggestion = {
  uid: string;
  kind: 'one-off' | 'series';
  organizer_slug: string;
  organizer_name: string;
  name: string;
  start: string;
  location?: string;
  series_label?: string;
  /**
   * YYYY-MM-DD past which a dismissal of this suggestion can be ignored. The
   * dismiss endpoint persists this so future-dated dismissals stay readable
   * via a single `valid_until >= today` predicate (no D1 IN-clause required).
   * One-offs use the start date; recurrence series use season_end; other
   * series fall back to a far-future sentinel.
   */
  valid_until: string;
};

/**
 * A review suggestion — an already-imported event whose upstream VEVENT has
 * drifted from its snapshot, or whose UID is no longer present in the feed.
 */
export type ReviewSuggestion = {
  kind: 'review';
  organizer_slug: string;
  uid: string;                 // matches event's ics_uid
  event_id: string;            // repo event id (for href + dismissal)
  organizer_name: string;
  name: string;
  start: string;               // for sorting; the event's next-relevant date
  diff: UpdateDiff;            // full diff (used for meta-text construction at the endpoint layer)
};

/**
 * A surfaced suggestion ready for the admin sidebar — the post-filter shape
 * built by `buildSuggestions`. Server-internal: the calendar endpoint maps it
 * onto the generic `SuggestionItem` shape (defined in
 * src/components/admin/Suggestions.tsx) before returning JSON.
 */
export type Suggestion = ImportSuggestion | ReviewSuggestion;

export interface ParsedVEvent {
  uid: string;
  summary: string;
  start: string;               // ISO date or date-time
  end?: string;
  location?: string;
  description?: string;
  url?: string;                // event_url (ICS URL property)
  registration_url?: string;   // typically extracted from DESCRIPTION (e.g. RidewithGPS)
  /**
   * ISO-8601 UTC timestamp of the upstream VEVENT's last edit, sourced from
   * LAST-MODIFIED with DTSTAMP as fallback (RFC 5545). Used to invalidate a
   * stale dismissal when the source event has been updated after dismissal.
   */
  last_modified?: string;
  series?: ParsedSeries;
  map_url?: string;            // raw map URL pulled from LOCATION
}

export type RecurrenceDay =
  | 'monday' | 'tuesday' | 'wednesday' | 'thursday'
  | 'friday' | 'saturday' | 'sunday';

export interface ParsedSeriesOverride {
  date: string;
  start_time?: string;
  location?: string;
  cancelled?: boolean;
  note?: string;
  uid?: string;
  event_url?: string;
  map_url?: string;
  registration_url?: string;
}

export interface ParsedSeries {
  kind: 'recurrence' | 'schedule';
  recurrence?: 'weekly' | 'biweekly';
  recurrence_day?: RecurrenceDay;
  season_start?: string;       // YYYY-MM-DD
  season_end?: string;         // YYYY-MM-DD
  skip_dates?: string[];
  overrides?: ParsedSeriesOverride[];
  schedule?: Array<{ date: string; start_time?: string; location?: string; uid?: string }>;
}

export interface FieldDiff {
  field: string;          // a member of MONITORED_MASTER_FIELDS or MONITORED_OCCURRENCE_FIELDS
  mine: string | undefined;
  upstream: string | undefined;
}

export interface ChangedOccurrence {
  uid: string;
  date: string;
  fields: FieldDiff[];
}

/**
 * A row in `occurrencesAdded`: a `ParsedSeriesOverride` that is guaranteed
 * to have a `uid` because `diffOccurrences` gates on `if (o.uid)` before
 * pushing. Using an intersection keeps the full override payload available
 * while narrowing the uid to non-optional.
 */
export type AddedOccurrence = ParsedSeriesOverride & { uid: string };

export interface UpdateDiff {
  master: FieldDiff[];
  occurrencesChanged: ChangedOccurrence[];
  occurrencesAdded: AddedOccurrence[];
  occurrencesNewlyCancelled: { uid: string; date: string; fields: FieldDiff[] }[];
  occurrencesRemoved: { uid: string; date: string }[];
  eventRemoved?: true;
}

export function isNonEmpty(d: UpdateDiff): boolean {
  return d.master.length > 0
      || d.occurrencesChanged.length > 0
      || d.occurrencesAdded.length > 0
      || d.occurrencesNewlyCancelled.length > 0
      || d.occurrencesRemoved.length > 0
      || d.eventRemoved === true;
}
