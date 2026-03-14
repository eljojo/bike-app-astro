import yaml from 'js-yaml';
import { CITY } from './config/config';
import { getPhotoUsages, updateSharedKeys, serializeSharedKeys, type PhotoUsage } from './photo-registry';
import { loadSharedKeysMap } from './load-admin-content';
import { mergeParkedPhotos, type ParkedPhotoEntry } from './media-merge';
import { upsertContentCache } from './cache';
import type { IGitService, FileChange } from './git/git.adapter-github';
import type { db } from './get-db';
import type { PhotoKeyChange } from './save-helpers';

/**
 * Extract a field value from a markdown file's YAML frontmatter.
 */
export function extractFrontmatterField(content: string, fieldName: string): string | undefined {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return undefined;
  const fm = yaml.load(fmMatch[1]) as Record<string, unknown>;
  return fm[fieldName] as string | undefined;
}

/**
 * Detect an orphaned photo (key removed or changed) and park it if not
 * used elsewhere. Returns the merged parked list and a file change to
 * include in the commit, or null if no parking was needed.
 */
export async function parkOrphanedPhoto(opts: {
  oldKey: string | undefined;
  newKey: string | undefined;
  contentType: PhotoUsage['type'];
  contentId: string;
  sharedKeysData: Record<string, Array<{ type: string; slug: string }>>;
  git: IGitService;
}): Promise<{ mergedParked: ParkedPhotoEntry[]; fileChange: FileChange } | null> {
  if (!opts.oldKey || opts.oldKey === opts.newKey) return null;

  const sharedKeysMap = await loadSharedKeysMap(opts.sharedKeysData);
  const usages = getPhotoUsages(sharedKeysMap, opts.oldKey);
  const usedElsewhere = usages.some(
    u => !(u.type === opts.contentType && u.slug === opts.contentId),
  );

  if (usedElsewhere) return null;

  const parkedPath = `${CITY}/parked-photos.yml`;
  const existingParkedFile = await opts.git.readFile(parkedPath);
  const existingParked: ParkedPhotoEntry[] = existingParkedFile
    ? (yaml.load(existingParkedFile.content) as ParkedPhotoEntry[]) || []
    : [];
  const mergedParked = mergeParkedPhotos(existingParked, [{ key: opts.oldKey }], new Set());
  const fileChange: FileChange = {
    path: parkedPath,
    content: yaml.dump(mergedParked, { lineWidth: -1 }),
  };

  return { mergedParked, fileChange };
}

/**
 * Update the shared-keys map and parked-photos caches in D1 after a
 * successful commit. Handles both single-key changes (place/event photo)
 * and multi-key changes (route media).
 */
export async function updatePhotoRegistryCache(opts: {
  database: ReturnType<typeof db>;
  sharedKeysData: Record<string, Array<{ type: string; slug: string }>>;
  keyChanges: PhotoKeyChange[];
  mergedParked?: ParkedPhotoEntry[];
}): Promise<void> {
  if (opts.keyChanges.length > 0) {
    const sharedKeysMap = await loadSharedKeysMap(opts.sharedKeysData);
    for (const change of opts.keyChanges) {
      updateSharedKeys(sharedKeysMap, change.key, change.usage, change.action);
    }
    await upsertContentCache(opts.database, {
      contentType: 'photo-shared-keys',
      contentSlug: '__global',
      data: serializeSharedKeys(sharedKeysMap),
      githubSha: 'n/a',
    });
  }

  if (opts.mergedParked) {
    await upsertContentCache(opts.database, {
      contentType: 'parked-photos',
      contentSlug: '__global',
      data: JSON.stringify(opts.mergedParked),
      githubSha: 'n/a',
    });
  }
}
