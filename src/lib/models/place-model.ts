import { z } from 'astro/zod';
import matter from 'gray-matter';
import { computeHashFromParts } from './content-model';

export const placeDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  name_fr: z.string().optional(),
  category: z.string(),
  lat: z.number(),
  lng: z.number(),
  status: z.string().default('published'),
  address: z.string().optional(),
  website: z.string().optional(),
  phone: z.string().optional(),
  google_maps_url: z.string().optional(),
  photo_key: z.string().optional(),
});

export type PlaceDetail = z.infer<typeof placeDetailSchema>;

interface GitFileSnapshot {
  content: string;
  sha: string;
}

export interface PlaceGitFiles {
  primaryFile: GitFileSnapshot | null;
}

/** Compute content hash for place conflict detection. */
export function computePlaceContentHash(content: string): string {
  return computeHashFromParts(content);
}

/** Compute place hash from git file snapshots. */
export function computePlaceContentHashFromFiles(currentFiles: PlaceGitFiles): string {
  if (!currentFiles.primaryFile) {
    throw new Error('Cannot compute place hash without primary file content');
  }
  return computePlaceContentHash(currentFiles.primaryFile.content);
}

/** Parse raw git content into canonical PlaceDetail. */
export function placeDetailFromGit(
  placeId: string,
  frontmatter: Record<string, unknown>,
): PlaceDetail {
  return {
    id: placeId,
    name: frontmatter.name as string,
    name_fr: frontmatter.name_fr as string | undefined,
    category: frontmatter.category as string,
    lat: frontmatter.lat as number,
    lng: frontmatter.lng as number,
    status: (frontmatter.status as string) || 'published',
    address: frontmatter.address as string | undefined,
    website: frontmatter.website as string | undefined,
    phone: frontmatter.phone as string | undefined,
    google_maps_url: frontmatter.google_maps_url as string | undefined,
    photo_key: frontmatter.photo_key as string | undefined,
  };
}

/** Serialize PlaceDetail to JSON string for D1 cache. */
export function placeDetailToCache(detail: PlaceDetail): string {
  return JSON.stringify(detail);
}

/** Build fresh place cache JSON from git file snapshots. */
export function buildFreshPlaceData(placeId: string, currentFiles: PlaceGitFiles): string {
  if (!currentFiles.primaryFile) {
    throw new Error('Cannot build place cache data without primary file content');
  }

  const { data: ghFrontmatter } = matter(currentFiles.primaryFile.content);
  const detail = placeDetailFromGit(placeId, ghFrontmatter);
  return placeDetailToCache(detail);
}

/** Deserialize and validate D1 cache blob into PlaceDetail. Throws on invalid data. */
export function placeDetailFromCache(blob: string): PlaceDetail {
  const parsed = JSON.parse(blob);
  return placeDetailSchema.parse(parsed);
}
