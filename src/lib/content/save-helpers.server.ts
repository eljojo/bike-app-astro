import matter from 'gray-matter';
import yaml from 'js-yaml';
import type { MediaUsage } from '../media/media-registry';
import type { Database } from '../../db/index';
import { deleteConsumedVideoJobs, enrichMediaFromVideoJobs } from '../media/video-enrichment';
import { bareVideoKey, videoKeyForGit } from '../media/video-service';
import { updateMediaRegistryCache } from '../media/media-parking.server';
import type { ParkedMediaEntry } from '../media/media-merge';

export interface MediaKeyChange {
  key: string;
  usage: MediaUsage;
  action: 'add' | 'remove';
}

/**
 * Build the media-key change list for afterCommit media registry updates.
 * Used by event-save and place-save handlers (route-save handles media arrays differently).
 */
export function buildSingleMediaKeyChanges(
  oldKey: string | undefined,
  newKey: string | undefined,
  contentType: MediaUsage['type'],
  slug: string,
): MediaKeyChange[] {
  const changes: MediaKeyChange[] = [];
  if (oldKey !== newKey) {
    if (oldKey) changes.push({ key: oldKey, usage: { type: contentType, slug }, action: 'remove' });
    if (newKey) changes.push({ key: newKey, usage: { type: contentType, slug }, action: 'add' });
  }
  return changes;
}

/**
 * Compute which media keys were added and removed between existing and new media arrays.
 * Used by route-save, ride-save, and event-save handlers.
 */
export function computeMediaKeyDiff(
  existingMedia: Array<{ key: string } | Record<string, unknown>>,
  newMedia: Array<{ key: string }>,
): { addedKeys: string[]; removedKeys: string[] } {
  const oldKeys = new Set(existingMedia.map(m => (m as { key: string }).key));
  const newKeys = new Set(newMedia.map(m => m.key));
  const addedKeys = newMedia.filter(m => !oldKeys.has(m.key)).map(m => m.key);
  const removedKeys = existingMedia
    .filter(m => !newKeys.has((m as { key: string }).key))
    .map(m => (m as { key: string }).key);
  return { addedKeys, removedKeys };
}

/**
 * Build media-key change list for media array changes (added/removed keys).
 * Used in afterCommit by route-save, ride-save, and event-save handlers.
 */
export function buildMediaKeyChanges(
  addedKeys: string[],
  removedKeys: string[],
  contentType: MediaUsage['type'],
  slug: string,
): MediaKeyChange[] {
  return [
    ...removedKeys.map(key => ({ key, usage: { type: contentType, slug }, action: 'remove' as const })),
    ...addedKeys.map(key => ({ key, usage: { type: contentType, slug }, action: 'add' as const })),
  ];
}

/**
 * Build the commit message trailer that records the resource path.
 * All save handlers append this to their commit messages.
 */
export function buildCommitTrailer(resourcePath: string): string {
  return `\n\nChanges: ${resourcePath}`;
}

/**
 * Merge frontmatter for a save operation. For new content, adds default
 * status and timestamps. For existing content, parses the current
 * frontmatter and overlays the update.
 */
export function mergeFrontmatter(
  isNew: boolean,
  existingContent: string | null,
  updates: Record<string, unknown>,
): Record<string, unknown> {
  if (isNew) {
    const fm: Record<string, unknown> = { ...updates };
    if (!fm.status) fm.status = 'published';
    const today = new Date().toISOString().split('T')[0];
    fm.created_at = today;
    fm.updated_at = today;
    return fm;
  }
  if (!existingContent) return { ...updates };
  const { data } = matter(existingContent);
  return { ...data, ...updates };
}

/**
 * Load existing media entries from auxiliary files.
 * Finds the first file matching *media.yml and parses it.
 * Used by route-save, ride-save, and event-save.
 */
export function loadExistingMedia(
  auxiliaryFiles: Record<string, { content: string; sha: string } | null> | undefined,
): Array<Record<string, unknown>> {
  if (!auxiliaryFiles) return [];
  const mediaPath = Object.keys(auxiliaryFiles).find(p => p.endsWith('media.yml'));
  if (!mediaPath) return [];
  const file = auxiliaryFiles[mediaPath];
  if (!file) return [];
  return (yaml.load(file.content) as Array<Record<string, unknown>>) || [];
}

/**
 * Enrich media items with video job metadata and annotate consumed video keys
 * for git storage. Shared by route-save and ride-save handlers.
 *
 * Only annotates newly-uploaded videos (consumed from videoJobs in this env).
 * Existing video keys keep their current prefix — re-annotating would
 * retarget production videos to staging paths (or vice versa).
 */
export async function enrichAndAnnotateMedia<T extends { key: string; type?: string }>(
  media: T[],
  database: Database,
): Promise<{
  annotatedMedia: T[];
  consumedVideoKeys: string[];
}> {
  const { enrichedMedia, consumedKeys } = await enrichMediaFromVideoJobs(media, database);
  const consumedSet = new Set(consumedKeys);
  const annotatedMedia = enrichedMedia.map(item =>
    item.type === 'video' && consumedSet.has(bareVideoKey(item.key))
      ? { ...item, key: videoKeyForGit(item.key) }
      : item
  );
  return { annotatedMedia, consumedVideoKeys: consumedKeys };
}

/**
 * Common afterCommit cleanup: update media registry and delete consumed video jobs.
 * Used by all four save handlers (route, ride, event, place).
 */
export async function afterCommitMediaCleanup(opts: {
  database: Database;
  sharedKeysData: Record<string, Array<{ type: string; slug: string }>>;
  mediaKeyChanges: MediaKeyChange[];
  consumedVideoKeys?: string[];
  mergedParked?: ParkedMediaEntry[];
}): Promise<void> {
  await updateMediaRegistryCache({
    database: opts.database,
    sharedKeysData: opts.sharedKeysData,
    keyChanges: opts.mediaKeyChanges,
    ...(opts.mergedParked !== undefined && { mergedParked: opts.mergedParked }),
  });
  if (opts.consumedVideoKeys?.length) {
    await deleteConsumedVideoJobs(opts.consumedVideoKeys, opts.database);
  }
}
