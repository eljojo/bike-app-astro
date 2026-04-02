import { z } from 'zod/v4';
import { bikePathSchema } from '../../schemas/bike-path-schema';

export const bikePathDetailSchema = bikePathSchema.extend({
  id: z.string(),
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
