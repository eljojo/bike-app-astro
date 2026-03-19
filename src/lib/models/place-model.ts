import { z } from 'astro/zod';
import { type GitFiles } from './content-model';
import { goodForEnum } from '../../schemas/index';

export const placeDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  name_fr: z.string().optional(),
  category: z.string(),
  lat: z.number(),
  lng: z.number(),
  status: z.string().default('published'),
  vibe: z.string().optional(),
  good_for: z.array(goodForEnum).default([]),
  address: z.string().optional(),
  website: z.string().optional(),
  phone: z.string().optional(),
  google_maps_url: z.string().optional(),
  photo_key: z.string().optional(),
});

export type PlaceDetail = z.infer<typeof placeDetailSchema>;

export type PlaceGitFiles = GitFiles;

/** Serialize PlaceDetail to JSON string for D1 cache. */
export function placeDetailToCache(detail: PlaceDetail): string {
  return JSON.stringify(detail);
}

/** Deserialize and validate D1 cache blob into PlaceDetail. Throws on invalid data. */
export function placeDetailFromCache(blob: string): PlaceDetail {
  const parsed = JSON.parse(blob);
  return placeDetailSchema.parse(parsed);
}
