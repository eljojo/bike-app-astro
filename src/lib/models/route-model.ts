import { z } from 'zod/v4';
import { baseMediaItemSchema, type GitFiles } from './content-model';

export const adminMediaItemSchema = baseMediaItemSchema.extend({
  uploaded_by: z.string().optional(),
  captured_at: z.string().optional(),
});

export const adminVariantSchema = z.object({
  name: z.string(),
  gpx: z.string(),
  distance_km: z.number().optional(),
  strava_url: z.string().optional(),
  rwgps_url: z.string().optional(),
  google_maps_url: z.string().optional(),
  komoot_url: z.string().optional(),
});

const localeContentSchema = z.object({
  name: z.string().optional(),
  tagline: z.string().optional(),
  body: z.string().optional(),
});

export const routeDetailSchema = z.object({
  slug: z.string(),
  name: z.string(),
  tagline: z.string(),
  tags: z.array(z.string()),
  distance: z.number(),
  status: z.string(),
  body: z.string(),
  media: z.array(adminMediaItemSchema),
  variants: z.array(adminVariantSchema),
  translations: z.record(z.string(), localeContentSchema).default({}),
});

export type RouteDetail = z.infer<typeof routeDetailSchema>;
export type AdminMediaItem = z.infer<typeof adminMediaItemSchema>;
export type AdminVariant = z.infer<typeof adminVariantSchema>;

export type RouteGitFiles = GitFiles;

/** Serialize RouteDetail to JSON string for D1 cache. */
export function routeDetailToCache(detail: RouteDetail): string {
  return JSON.stringify(detail);
}

/** Deserialize and validate D1 cache blob into RouteDetail. Throws on invalid data. */
export function routeDetailFromCache(blob: string): RouteDetail {
  const parsed = JSON.parse(blob);
  return routeDetailSchema.parse(parsed);
}
