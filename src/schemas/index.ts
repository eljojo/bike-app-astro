import { z } from 'astro/zod';

export const variantSchema = z.object({
  name: z.string(),
  gpx: z.string(),
  distance_km: z.number().optional(),
  strava_url: z.string().optional(),
  rwgps_url: z.string().optional(),
  google_maps_url: z.string().optional(),
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
    rawGpx: z.string().optional(),
  })).default({}),
  renderedBody: z.string().default(''),
  translations: z.record(z.string(), z.looseObject({
    name: z.string().optional(),
    tagline: z.string().optional(),
    renderedBody: z.string().optional(),
  })).default({}),
});

export const placeSchema = z.object({
  name: z.string(),
  name_fr: z.string().optional(),
  category: z.string(),
  lat: z.number(),
  lng: z.number(),
  status: z.literal('published').default('published'),
  address: z.string().optional(),
  website: z.string().optional(),
  phone: z.string().optional(),
  google_maps_url: z.string().optional(),
  photo_key: z.string().optional(),
});

export const guideSchema = z.object({
  name: z.string(),
  status: z.enum(['published', 'draft']),
  tagline: z.string().optional(),
});

export const organizerSchema = z.object({
  name: z.string(),
  website: z.string().optional(),
  instagram: z.string().optional(),
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
  start_time: z.string().optional(),
  end_date: z.string().optional(),
  end_time: z.string().optional(),
  registration_url: z.string().optional(),
  distances: z.string().optional(),
  location: z.string().optional(),
  review_url: z.string().optional(),
  organizer: z.union([z.string(), organizerSchema]).optional(),
  poster_key: z.string().optional(),
  poster_content_type: z.string().optional(),
});
