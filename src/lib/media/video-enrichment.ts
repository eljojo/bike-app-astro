import { inArray } from 'drizzle-orm';
import { videoJobs } from '../../db/schema';
import { buildVideoMetadata } from './video-metadata';
import { bareVideoKey } from './video-service';
import type { Database } from '../../db/index';

/**
 * Enrich media items with metadata from ready videoJobs rows in D1.
 * Returns the enriched media array and the keys of consumed videoJobs rows
 * (to be deleted after successful git commit).
 */
export async function enrichMediaFromVideoJobs<T extends { key: string; type?: string }>(
  media: T[],
  database: Database,
): Promise<{ enrichedMedia: T[]; consumedKeys: string[] }> {
  const videoKeys = media.filter(m => m.type === 'video').map(m => bareVideoKey(m.key));
  if (videoKeys.length === 0) return { enrichedMedia: media, consumedKeys: [] };

  const rows = await database.select().from(videoJobs)
    .where(inArray(videoJobs.key, videoKeys));

  const readyRows = rows.filter(r => r.status === 'ready');
  if (readyRows.length === 0) return { enrichedMedia: media, consumedKeys: [] };

  const metadataByKey = new Map(
    readyRows.map(r => [r.key, buildVideoMetadata(r)]),
  );

  const enrichedMedia = media.map(item => {
    if (item.type !== 'video') return item;
    const metadata = metadataByKey.get(bareVideoKey(item.key));
    if (!metadata) return item;
    return { ...item, ...metadata } as T;
  });

  return { enrichedMedia, consumedKeys: readyRows.map(r => r.key) };
}

/** Delete videoJobs rows after metadata has been successfully committed to git. */
export async function deleteConsumedVideoJobs(
  keys: string[],
  database: Database,
): Promise<void> {
  if (keys.length === 0) return;
  await database.delete(videoJobs).where(inArray(videoJobs.key, keys));
}
