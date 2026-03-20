import matter from 'gray-matter';
import { computeHashFromParts } from './content-hash.server';
import { placeDetailToCache } from './place-model';
import type { PlaceDetail, PlaceGitFiles } from './place-model';

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
    vibe: frontmatter.vibe as string | undefined,
    good_for: (frontmatter.good_for as PlaceDetail['good_for']) || [],
    address: frontmatter.address as string | undefined,
    website: frontmatter.website as string | undefined,
    phone: frontmatter.phone as string | undefined,
    google_maps_url: frontmatter.google_maps_url as string | undefined,
    photo_key: frontmatter.photo_key as string | undefined,
  };
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
