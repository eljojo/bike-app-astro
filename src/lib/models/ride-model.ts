import { createHash } from 'node:crypto';
import { z } from 'astro/zod';

const mediaItemSchema = z.object({
  key: z.string(),
  caption: z.string().optional(),
  cover: z.boolean().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  type: z.string().optional(),
  score: z.number().optional(),
});

const variantSchema = z.object({
  name: z.string(),
  gpx: z.string(),
  distance_km: z.number().optional(),
  strava_url: z.string().optional(),
  rwgps_url: z.string().optional(),
});

const rideDetailSchema = z.object({
  slug: z.string(),
  name: z.string(),
  tagline: z.string().default(''),
  tags: z.array(z.string()).default([]),
  status: z.string().default('published'),
  body: z.string().default(''),
  media: z.array(mediaItemSchema).default([]),
  variants: z.array(variantSchema).default([]),
  contentHash: z.string(),
  ride_date: z.string().default(''),
  country: z.string().optional(),
  tour_slug: z.string().optional(),
  highlight: z.boolean().optional(),
  elapsed_time_s: z.number().optional(),
  moving_time_s: z.number().optional(),
  average_speed_kmh: z.number().optional(),
});

export type RideDetail = z.infer<typeof rideDetailSchema>;

/** Compute content hash for ride conflict detection. Canonical order: sidecar, gpx, media. */
export function computeRideContentHash(sidecarContent: string, gpxContent?: string, mediaContent?: string): string {
  const hash = createHash('md5').update(sidecarContent);
  if (gpxContent) hash.update(gpxContent);
  if (mediaContent) hash.update(mediaContent);
  return hash.digest('hex');
}

/** Serialize ride detail for D1 cache storage. */
export function rideDetailToCache(detail: Record<string, unknown>): string {
  return JSON.stringify(detail);
}

/** Parse and validate ride detail from D1 cache. Returns null on invalid data. */
export function rideDetailFromCache(data: string): RideDetail | null {
  try {
    const parsed = JSON.parse(data);
    const result = rideDetailSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
