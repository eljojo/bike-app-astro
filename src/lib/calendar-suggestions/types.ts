// src/lib/calendar-suggestions/types.ts
export interface ParsedFeed {
  fetched_at: string;          // ISO
  source_url: string;
  events: ParsedVEvent[];
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
