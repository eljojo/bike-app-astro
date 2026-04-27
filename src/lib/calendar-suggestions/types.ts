// src/lib/calendar-suggestions/types.ts
export interface ParsedFeed {
  fetched_at: string;          // ISO
  source_url: string;
  events: ParsedVEvent[];
}

/**
 * A surfaced suggestion ready for the admin sidebar — the post-filter shape
 * built by `buildSuggestions`. Lives here (not in build.server.ts) so the
 * browser sidebar can `import type` it without crossing the .server boundary.
 */
export interface Suggestion {
  uid: string;
  kind: 'one-off' | 'series';
  organizer_slug: string;
  organizer_name: string;
  name: string;
  start: string;
  location?: string;
  series_label?: string;
}

export interface ParsedVEvent {
  uid: string;
  summary: string;
  start: string;               // ISO date or date-time
  end?: string;
  location?: string;
  description?: string;
  url?: string;
  series?: ParsedSeries;
}

export type RecurrenceDay =
  | 'monday' | 'tuesday' | 'wednesday' | 'thursday'
  | 'friday' | 'saturday' | 'sunday';

export interface ParsedSeries {
  kind: 'recurrence' | 'schedule';
  recurrence?: 'weekly' | 'biweekly';
  recurrence_day?: RecurrenceDay;
  season_start?: string;       // YYYY-MM-DD
  season_end?: string;         // YYYY-MM-DD
  skip_dates?: string[];
  overrides?: Array<{ date: string; start_time?: string; location?: string; cancelled?: boolean; note?: string }>;
  schedule?: Array<{ date: string; start_time?: string; location?: string }>;
}
