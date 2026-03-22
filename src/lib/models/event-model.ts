import { z } from 'astro/zod';
import { baseMediaItemSchema, type GitFiles } from './content-model';

const organizerRefSchema = z.object({
  name: z.string(),
  website: z.string().optional(),
  instagram: z.string().optional(),
  photo_key: z.string().optional(),
  photo_content_type: z.string().optional(),
  photo_width: z.number().optional(),
  photo_height: z.number().optional(),
});

const waypointDetailSchema = z.object({
  place: z.string(),
  type: z.enum(['checkpoint', 'danger', 'poi']),
  label: z.string(),
  distance_km: z.number().optional(),
  opening: z.string().optional(),
  closing: z.string().optional(),
  route: z.string().optional(),
  note: z.string().optional(),
});

const registrationDetailSchema = z.object({
  url: z.string().optional(),
  slots: z.number().optional(),
  price: z.string().optional(),
  deadline: z.string().optional(),
  departure_groups: z.array(z.string()).optional(),
});

const resultDetailSchema = z.object({
  brevet_no: z.number().optional(),
  last_name: z.string(),
  first_name: z.string().optional(),
  time: z.string().optional(),
  homologation: z.string().optional(),
  status: z.enum(['DNS', 'DNF', 'DQ']).optional(),
});

export const eventMediaItemSchema = baseMediaItemSchema.extend({
  type: z.string().optional(),
});

// Mirrors seriesOccurrenceOverrideSchema in src/schemas/index.ts — keep in sync
const seriesOccurrenceOverrideSchema = z.object({
  date: z.string(),
  location: z.string().optional(),
  start_time: z.string().optional(),
  meet_time: z.string().optional(),
  note: z.string().optional(),
  cancelled: z.boolean().optional(),
  rescheduled_from: z.string().optional(),
});

// Mirrors eventSeriesSchema in src/schemas/index.ts — keep in sync
const eventSeriesSchema = z.object({
  // Pattern 1: recurrence rule
  recurrence: z.enum(['weekly', 'biweekly']).optional(),
  recurrence_day: z.enum([
    'monday', 'tuesday', 'wednesday', 'thursday',
    'friday', 'saturday', 'sunday',
  ]).optional(),
  season_start: z.string().optional(),
  season_end: z.string().optional(),
  skip_dates: z.array(z.string()).optional(),
  overrides: z.array(seriesOccurrenceOverrideSchema).optional(),

  // Pattern 2: explicit schedule
  schedule: z.array(seriesOccurrenceOverrideSchema).optional(),
}).refine(
  d => (d.recurrence && d.recurrence_day && d.season_start && d.season_end) || d.schedule?.length,
  { message: 'Series needs either recurrence rule or explicit schedule' },
);

export const eventDetailSchema = z.object({
  id: z.string(),
  slug: z.string(),
  year: z.string(),
  name: z.string(),
  start_date: z.string(),
  event_date: z.string().optional(),
  start_time: z.string().optional(),
  meet_time: z.string().optional(),
  end_date: z.string().optional(),
  end_time: z.string().optional(),
  time_limit_hours: z.number().optional(),
  status: z.string().optional(),
  routes: z.array(z.string()).default([]),
  registration: registrationDetailSchema.optional(),
  registration_url: z.string().optional(),
  waypoints: z.array(waypointDetailSchema).default([]),
  results: z.array(resultDetailSchema).default([]),
  gpx_include_waypoints: z.boolean().optional(),
  distances: z.string().optional(),
  location: z.string().optional(),
  review_url: z.string().optional(),
  organizer: z.union([z.string(), organizerRefSchema]).optional(),
  poster_key: z.string().optional(),
  poster_content_type: z.string().optional(),
  poster_width: z.number().optional(),
  poster_height: z.number().optional(),
  tags: z.array(z.string()).default([]),
  previous_event: z.string().optional(),
  edition: z.string().optional(),
  banner_text: z.string().optional(),
  linked_routes: z.array(z.object({
    route: z.string(),
    variant: z.string().optional(),
    label: z.string(),
  })).optional(),
  event_url: z.string().optional(),
  map_url: z.string().optional(),
  body: z.string(),
  media: z.array(eventMediaItemSchema).default([]),
  series: eventSeriesSchema.optional(),
});

export type EventDetail = z.infer<typeof eventDetailSchema>;

/** Returns poster_key, falling back to the first photo in the media array. */
export function eventCoverKey(data: { poster_key?: string; media?: Array<{ key: string }> }): string | undefined {
  return data.poster_key || data.media?.[0]?.key;
}
export type EventWaypoint = z.infer<typeof waypointDetailSchema>;
export type EventResult = z.infer<typeof resultDetailSchema>;
export type EventRegistration = z.infer<typeof registrationDetailSchema>;
export type EventOrganizerRef = z.infer<typeof organizerRefSchema>;
export type SeriesOccurrenceOverride = z.infer<typeof seriesOccurrenceOverrideSchema>;
export type EventSeries = z.infer<typeof eventSeriesSchema>;

export type EventGitFiles = GitFiles;

/** Serialize EventDetail to JSON string for D1 cache. */
export function eventDetailToCache(detail: EventDetail): string {
  return JSON.stringify(detail);
}

/** Deserialize and validate D1 cache blob into EventDetail. Throws on invalid data. */
export function eventDetailFromCache(blob: string): EventDetail {
  const parsed = JSON.parse(blob);
  return eventDetailSchema.parse(parsed);
}
