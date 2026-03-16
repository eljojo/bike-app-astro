import matter from 'gray-matter';
import yaml from 'js-yaml';
import type { PhotoUsage } from '../media/photo-registry';

export interface PhotoKeyChange {
  key: string;
  usage: PhotoUsage;
  action: 'add' | 'remove';
}

/**
 * Build the photo-key change list for afterCommit photo registry updates.
 * Used by event-save and place-save handlers (route-save handles media arrays differently).
 */
export function buildPhotoKeyChanges(
  oldKey: string | undefined,
  newKey: string | undefined,
  contentType: PhotoUsage['type'],
  slug: string,
): PhotoKeyChange[] {
  const changes: PhotoKeyChange[] = [];
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
 * Build photo-key change list for media array changes (added/removed keys).
 * Used in afterCommit by route-save, ride-save, and event-save handlers.
 */
export function buildMediaKeyChanges(
  addedKeys: string[],
  removedKeys: string[],
  contentType: PhotoUsage['type'],
  slug: string,
): PhotoKeyChange[] {
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
