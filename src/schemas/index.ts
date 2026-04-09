import { z } from 'zod/v4';
export { bikePathSchema } from './bike-path-schema';
import { baseMediaItemSchema } from '../lib/models/content-model';
import { variantSchema, ROUTE_STATUSES } from '../lib/models/route-model';
import {
  waypointSchema,
  registrationSchema,
  resultSchema,
  eventSeriesSchema,
  EVENT_STATUSES,
} from '../lib/models/event-model';

// Re-export schemas that are canonical in model files
export { variantSchema } from '../lib/models/route-model';
export { waypointSchema, registrationSchema, resultSchema } from '../lib/models/event-model';

export const routeSchema = z.object({
  name: z.string(),
  status: z.enum(ROUTE_STATUSES),
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
  gpxHash: z.string().optional(),
  gpxHashes: z.record(z.string(), z.string()).default({}),
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
  waypoints: z.array(z.union([
    z.string(),
    z.object({ name: z.string(), lat: z.number(), lng: z.number() }),
  ])).optional(),
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
    'telephone', 'phone', 'email',
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
  status: z.enum(ROUTE_STATUSES),
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

export const eventSchema = z.object({
  name: z.string(),
  start_date: z.string(),
  event_date: z.string().optional(),
  start_time: z.string().optional(),
  meet_time: z.string().optional(),
  end_date: z.string().optional(),
  end_time: z.string().optional(),
  time_limit_hours: z.number().optional(),
  status: z.enum(EVENT_STATUSES).optional(),
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
