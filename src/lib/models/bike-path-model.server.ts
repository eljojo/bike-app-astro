import matter from 'gray-matter';
import { computeHashFromParts } from './content-hash.server';
import { bikePathDetailToCache } from './bike-path-model';
import type { BikePathDetail } from './bike-path-model';
import type { CurrentFiles } from '../content/content-save';

/** Compute content hash for bike path conflict detection. */
export function computeBikePathContentHash(content: string): string {
  return computeHashFromParts(content);
}

/** Compute bike path hash from git file snapshots. */
export function computeBikePathContentHashFromFiles(currentFiles: CurrentFiles): string {
  if (!currentFiles.primaryFile) {
    throw new Error('Cannot compute bike path hash without primary file content');
  }
  return computeBikePathContentHash(currentFiles.primaryFile.content);
}

/** Parse raw git content into canonical BikePathDetail. */
export function bikePathDetailFromGit(
  bikePathId: string,
  frontmatter: Record<string, unknown>,
  body: string,
): BikePathDetail {
  return {
    id: bikePathId,
    name: frontmatter.name as string | undefined,
    name_fr: frontmatter.name_fr as string | undefined,
    vibe: frontmatter.vibe as string | undefined,
    hidden: (frontmatter.hidden as boolean) ?? false,
    includes: (frontmatter.includes as string[]) ?? [],
    photo_key: frontmatter.photo_key as string | undefined,
    tags: (frontmatter.tags as string[]) ?? [],
    body: body.trim(),
  };
}

/** Build fresh bike path cache JSON from git file snapshots. */
export function buildFreshBikePathData(bikePathId: string, currentFiles: CurrentFiles): string {
  if (!currentFiles.primaryFile) {
    throw new Error('Cannot build bike path cache data without primary file content');
  }

  const { data: ghFrontmatter, content } = matter(currentFiles.primaryFile.content);
  const detail = bikePathDetailFromGit(bikePathId, ghFrontmatter, content);
  return bikePathDetailToCache(detail);
}
