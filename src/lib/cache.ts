import { contentEdits } from '../db/schema';

interface CacheEntry {
  contentType: string;
  contentSlug: string;
  data: string;
  githubSha: string;
}

/**
 * Upsert a content cache entry in D1.
 * Centralizes the insert-on-conflict-update pattern used by
 * content-save.ts and admin-revert.ts.
 */
export async function upsertContentCache(
  database: any,
  entry: CacheEntry,
): Promise<void> {
  const now = new Date().toISOString();
  await database.insert(contentEdits).values({
    contentType: entry.contentType,
    contentSlug: entry.contentSlug,
    data: entry.data,
    githubSha: entry.githubSha,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [contentEdits.contentType, contentEdits.contentSlug],
    set: {
      data: entry.data,
      githubSha: entry.githubSha,
      updatedAt: now,
    },
  });
}
