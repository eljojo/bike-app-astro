import { z } from 'astro/zod';

export const bikePathDetailSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  name_fr: z.string().optional(),
  vibe: z.string().optional(),
  hidden: z.boolean().default(false),
  stub: z.boolean().default(false),
  featured: z.boolean().default(false),
  includes: z.array(z.string()).default([]),
  photo_key: z.string().optional(),
  tags: z.array(z.string()).default([]),
  body: z.string().default(''),
  contentHash: z.string().optional(),
});

export type BikePathDetail = z.infer<typeof bikePathDetailSchema>;

export type { AdminBikePath } from '../../types/admin';

/** Serialize BikePathDetail to JSON string for D1 cache. */
export function bikePathDetailToCache(detail: BikePathDetail): string {
  return JSON.stringify(detail);
}

/** Deserialize and validate D1 cache blob into BikePathDetail. Throws on invalid data. */
export function bikePathDetailFromCache(blob: string): BikePathDetail {
  const parsed = JSON.parse(blob);
  return bikePathDetailSchema.parse(parsed);
}
