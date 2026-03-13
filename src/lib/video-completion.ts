/**
 * Video transcoding helpers and background completion processing.
 *
 * Output key conventions: MediaConvert writes transcoded files to
 * `{key}/{key}-{codec}.mp4` and poster frames to `{key}/{key}-poster.0000000.jpg`.
 * These helpers centralize that naming so it's defined once.
 */

import { eq } from 'drizzle-orm';
import type { AppEnv } from './app-env';
import type { BucketLike } from './storage';
import { db } from './get-db';
import { videoJobs } from '../db/schema';

/** H.264 output key — used to check if transcoding is complete. */
export function h264OutputKey(key: string): string {
  return `${key}/${key}-h264.mp4`;
}

/** Poster frame key — MediaConvert frame capture output. */
export function posterKeyForVideo(key: string): string {
  return `${key}/${key}-poster.0000000.jpg`;
}

/** Check whether the H.264 output file exists in the bucket. */
export async function checkVideoReady(bucket: BucketLike, key: string): Promise<boolean> {
  const result = await bucket.head(h264OutputKey(key));
  return result !== null;
}

/**
 * Process pending video jobs — called by the cron endpoint.
 * Updates completed jobs to 'ready', marks stale ones (>2h) as 'failed'.
 */
export async function processPendingVideos(_env: AppEnv): Promise<{ processed: number; ready: number; failed: number }> {
  const database = db();
  const pending = await database
    .select()
    .from(videoJobs)
    .where(eq(videoJobs.status, 'transcoding'))
    .all();

  let ready = 0;
  let failed = 0;

  for (const job of pending) {
    const isReady = await checkVideoReady(_env.BUCKET, job.key);

    if (isReady) {
      await database.update(videoJobs)
        .set({
          status: 'ready',
          posterKey: posterKeyForVideo(job.key),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(videoJobs.id, job.id));
      ready++;
    } else {
      // Mark as failed if transcoding for >2 hours
      const age = Date.now() - new Date(job.createdAt).getTime();
      if (age > 2 * 60 * 60 * 1000) {
        await database.update(videoJobs)
          .set({ status: 'failed', updatedAt: new Date().toISOString() })
          .where(eq(videoJobs.id, job.id));
        failed++;
      }
    }
  }

  return { processed: pending.length, ready, failed };
}
