import { createHash } from 'node:crypto';
import { z } from 'zod';
import yaml from 'js-yaml';

const adminMediaItemSchema = z.object({
  key: z.string(),
  caption: z.string().optional(),
  cover: z.boolean().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});

const adminVariantSchema = z.object({
  name: z.string(),
  gpx: z.string(),
  distance_km: z.number().optional(),
  strava_url: z.string().optional(),
  rwgps_url: z.string().optional(),
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
});

export type RouteDetail = z.infer<typeof routeDetailSchema>;
export type AdminMediaItem = z.infer<typeof adminMediaItemSchema>;
export type AdminVariant = z.infer<typeof adminVariantSchema>;

/** Compute content hash for route conflict detection. Hashes primary + media content. */
export function computeRouteContentHash(primaryContent: string, mediaContent: string | undefined): string {
  const hash = createHash('md5').update(primaryContent);
  if (mediaContent) hash.update(mediaContent);
  return hash.digest('hex');
}

/**
 * Parse raw git content (frontmatter + body + media.yml) into canonical RouteDetail.
 * Filters media to photos only (videos managed separately, not shown in admin UI).
 */
export function routeDetailFromGit(
  slug: string,
  frontmatter: Record<string, unknown>,
  body: string,
  mediaYml?: string,
): RouteDetail {
  let media: AdminMediaItem[] = [];
  if (mediaYml) {
    const rawMedia = (yaml.load(mediaYml) as Array<Record<string, unknown>>) || [];
    media = rawMedia
      .filter((m) => m.type === 'photo')
      .map((m) => {
        const item: AdminMediaItem = { key: m.key as string };
        if (m.caption != null) item.caption = m.caption as string;
        if (m.cover != null) item.cover = m.cover as boolean;
        return item;
      });
  }

  return {
    slug,
    name: frontmatter.name as string,
    tagline: (frontmatter.tagline as string) || '',
    tags: (frontmatter.tags as string[]) || [],
    distance: (frontmatter.distance_km as number) || 0,
    status: (frontmatter.status as string) || 'draft',
    body: body.trim(),
    media,
    variants: (frontmatter.variants as AdminVariant[]) || [],
  };
}

/** Serialize RouteDetail to JSON string for D1 cache. */
export function routeDetailToCache(detail: RouteDetail): string {
  return JSON.stringify(detail);
}

/** Deserialize and validate D1 cache blob into RouteDetail. Throws on invalid data. */
export function routeDetailFromCache(blob: string): RouteDetail {
  const parsed = JSON.parse(blob);
  return routeDetailSchema.parse(parsed);
}
