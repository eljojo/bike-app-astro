import { z } from 'astro/zod';
import { baseMediaItemSchema } from '../lib/models/content-model';

export const variantSchema = z.object({
  name: z.string(),
  gpx: z.string(),
  distance_km: z.number().optional(),
  strava_url: z.string().optional(),
  rwgps_url: z.string().optional(),
  google_maps_url: z.string().optional(),
  komoot_url: z.string().optional(),
});

export const routeSchema = z.object({
  name: z.string(),
  status: z.enum(['published', 'draft']),
  distance_km: z.number(),
  tags: z.array(z.string()).default([]),
  tagline: z.string().optional(),
  variants: z.array(variantSchema).default([]),
  created_at: z.string(),
  updated_at: z.string(),
  media: z.array(z.object({
    type: z.enum(['photo', 'video']),
    key: z.string(),
    handle: z.string(),
    cover: z.boolean().optional(),
    caption: z.string().optional(),
    title: z.string().optional(),
    score: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    duration: z.string().optional(),
    orientation: z.string().optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
    uploaded_by: z.string().optional(),
    captured_at: z.string().optional(),
  })).default([]),
  gpxTracks: z.record(z.string(), z.object({
    points: z.array(z.object({ lat: z.number(), lon: z.number(), ele: z.number().optional() })),
    distance_m: z.number(),
    elevation_gain_m: z.number(),
    max_gradient_pct: z.number(),
    polyline: z.string(),
  })).default({}),
  gpxRelativePath: z.string().optional(),
  renderedBody: z.string().default(''),
  translations: z.record(z.string(), z.looseObject({
    name: z.string().optional(),
    tagline: z.string().optional(),
    renderedBody: z.string().optional(),
  })).default({}),

  // Ride-specific fields (used by blog instances, ignored by wiki instances)
  handle: z.string().optional(),
  ride_date: z.string().optional(),
  tour_slug: z.string().optional(),
  country: z.string().optional(),
  highlight: z.boolean().optional(),
  total_elevation_gain: z.number().optional(),
  elapsed_time_s: z.number().optional(),
  moving_time_s: z.number().optional(),
  average_speed_kmh: z.number().optional(),
  homepage_featured: z.boolean().optional(),
  waypoints: z.array(z.string()).optional(),
});

export const goodForEnum = z.enum([
  'refuel', 'destination', 'swimming', 'view',
  'rest-stop', 'family', 'post-ride', 'supplies', 'photo-op', 'picnic',
]);

export const socialLinkSchema = z.object({
  platform: z.enum([
    'instagram', 'facebook', 'strava', 'youtube',
    'meetup', 'tiktok', 'bluesky', 'threads', 'website',
    'discord', 'google_form', 'linktree',
    'rwgps', 'komoot', 'newsletter', 'mastodon', 'booking',
    'telephone', 'email',
  ]),
  url: z.string(),
});

export const placeSchema = z.object({
  name: z.string(),
  name_fr: z.string().optional(),
  category: z.string(),
  lat: z.number(),
  lng: z.number(),
  status: z.literal('published').default('published'),
  description: z.string().optional(),
  vibe: z.string().optional(),
  good_for: z.array(goodForEnum).default([]),
  address: z.string().optional(),
  website: z.string().optional(),
  phone: z.string().optional(),
  google_maps_url: z.string().optional(),
  photo_key: z.string().optional(),
  media: z.array(baseMediaItemSchema).default([]),
  organizer: z.string().optional(),
  social_links: z.array(socialLinkSchema).default([]),
});

export const guideSchema = z.object({
  name: z.string(),
  status: z.enum(['published', 'draft']),
  tagline: z.string().optional(),
});

export const organizerSchema = z.object({
  name: z.string(),
  tagline: z.string().optional(),
  tags: z.array(z.string()).default([]),
  featured: z.boolean().default(false),
  hidden: z.boolean().default(false),
  website: z.string().optional(),
  instagram: z.string().optional(),
  social_links: z.array(socialLinkSchema).default([]),
  photo_key: z.string().optional(),
  photo_width: z.number().optional(),
  photo_height: z.number().optional(),
  photo_content_type: z.string().optional(),
  media: z.array(baseMediaItemSchema).default([]),
});

export const pageSchema = z.object({
  title: z.string(),
  renderedBody: z.string().default(''),
  translations: z.record(z.string(), z.object({
    title: z.string().optional(),
    renderedBody: z.string(),
  })).default({}),
});

export const waypointSchema = z.object({
  place: z.string(),
  type: z.enum(['checkpoint', 'danger', 'poi']),
  label: z.string(),
  distance_km: z.number().optional(),
  opening: z.string().optional(),
  closing: z.string().optional(),
  route: z.string().optional(),
  note: z.string().optional(),
});

export const registrationSchema = z.object({
  url: z.string().optional(),
  slots: z.number().optional(),
  price: z.string().optional(),
  deadline: z.string().optional(),
  departure_groups: z.array(z.string()).optional(),
});

export const resultSchema = z.object({
  brevet_no: z.number().optional(),
  last_name: z.string(),
  first_name: z.string().optional(),
  time: z.string().optional(),
  homologation: z.string().optional(),
  status: z.enum(['DNS', 'DNF', 'DQ']).optional(),
});

// Mirrors seriesOccurrenceOverrideSchema in src/lib/models/event-model.ts — keep in sync
const seriesOccurrenceOverrideSchema = z.object({
  date: z.string(),
  location: z.string().optional(),
  start_time: z.string().optional(),
  meet_time: z.string().optional(),
  note: z.string().optional(),
  cancelled: z.boolean().optional(),
  rescheduled_from: z.string().optional(),
});

// Mirrors eventSeriesSchema in src/lib/models/event-model.ts — keep in sync
const eventSeriesSchema = z.object({
  recurrence: z.enum(['weekly', 'biweekly']).optional(),
  recurrence_day: z.enum([
    'monday', 'tuesday', 'wednesday', 'thursday',
    'friday', 'saturday', 'sunday',
  ]).optional(),
  season_start: z.string().optional(),
  season_end: z.string().optional(),
  skip_dates: z.array(z.string()).optional(),
  overrides: z.array(seriesOccurrenceOverrideSchema).optional(),
  schedule: z.array(seriesOccurrenceOverrideSchema).optional(),
}).refine(
  d => (d.recurrence && d.recurrence_day && d.season_start && d.season_end) || d.schedule?.length,
  { message: 'Series needs either recurrence rule or explicit schedule' },
);

export const eventSchema = z.object({
  name: z.string(),
  start_date: z.string(),
  event_date: z.string().optional(),
  start_time: z.string().optional(),
  meet_time: z.string().optional(),
  end_date: z.string().optional(),
  end_time: z.string().optional(),
  time_limit_hours: z.number().optional(),
  status: z.enum(['upcoming', 'open', 'closed', 'past']).optional(),
  routes: z.array(z.string()).optional(),
  registration: registrationSchema.optional(),
  registration_url: z.string().optional(),
  waypoints: z.array(waypointSchema).optional(),
  results: z.array(resultSchema).optional(),
  gpx_include_waypoints: z.boolean().optional(),
  distances: z.string().optional(),
  location: z.string().optional(),
  review_url: z.string().optional(),
  organizer: z.union([z.string(), organizerSchema]).optional(),
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
  media: z.array(z.object({
    type: z.string().optional(),
    key: z.string(),
    caption: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  })).optional(),
  series: eventSeriesSchema.optional(),
});
