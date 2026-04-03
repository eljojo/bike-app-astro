import { z } from 'zod/v4';
import { type GitFiles } from './content-model';
import { goodForEnum, socialLinkSchema } from '../../schemas/index';

export const PLACE_STATUSES = ['published'] as const;

export const placeDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  name_fr: z.string().optional(),
  category: z.string(),
  lat: z.number(),
  lng: z.number(),
  status: z.enum(PLACE_STATUSES).default('published'),
  vibe: z.string().optional(),
  good_for: z.array(goodForEnum).default([]),
  address: z.string().optional(),
  website: z.string().optional(),
  phone: z.string().optional(),
  google_maps_url: z.string().optional(),
  photo_key: z.string().optional(),
  organizer: z.string().optional(),
  social_links: z.array(socialLinkSchema).default([]),
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
