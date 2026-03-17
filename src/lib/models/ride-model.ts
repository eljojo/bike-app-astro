import { z } from 'astro/zod';
import { baseMediaItemSchema, type GitFiles } from './content-model';

export const rideMediaItemSchema = baseMediaItemSchema.extend({
  type: z.string().optional(),
  score: z.number().optional(),
});

export const rideVariantSchema = z.object({
  name: z.string(),
  gpx: z.string(),
  distance_km: z.number().optional(),
  strava_url: z.string().optional(),
  rwgps_url: z.string().optional(),
});

export const rideDetailSchema = z.object({
  slug: z.string(),
  name: z.string(),
  tagline: z.string().default(''),
  tags: z.array(z.string()).default([]),
  status: z.string().default('published'),
  body: z.string().default(''),
  media: z.array(rideMediaItemSchema).default([]),
  variants: z.array(rideVariantSchema).default([]),
  contentHash: z.string(),
  ride_date: z.string().default(''),
  country: z.string().optional(),
  tour_slug: z.string().optional(),
  highlight: z.boolean().optional(),
  strava_id: z.string().optional(),
  privacy_zone: z.boolean().optional(),
  elapsed_time_s: z.number().optional(),
  moving_time_s: z.number().optional(),
  average_speed_kmh: z.number().optional(),
});

export type RideDetail = z.infer<typeof rideDetailSchema>;
export type RideMediaItem = z.infer<typeof rideMediaItemSchema>;

export interface RideGitFiles extends GitFiles {
  primaryFile: { content: string; sha: string } | null;
  auxiliaryFiles?: Record<string, { content: string; sha: string } | null>;
}

/** Serialize RideDetail to JSON string for D1 cache. */
export function rideDetailToCache(detail: RideDetail): string {
  return JSON.stringify(detail);
}

/** Deserialize and validate D1 cache blob into RideDetail. Throws on invalid data. */
export function rideDetailFromCache(blob: string): RideDetail {
  const parsed = JSON.parse(blob);
  return rideDetailSchema.parse(parsed);
}
