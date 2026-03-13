/**
 * Background video completion — checks pending video jobs and updates their status.
 *
 * Used by the cron API endpoint. When a transcoding job completes (output files
 * appear in the bucket), the job status is updated to 'ready'. Jobs that have
 * been transcoding for more than 2 hours are marked as 'failed'.
 */

import { eq } from 'drizzle-orm';
import type { AppEnv } from './app-env';
import type { BucketLike } from './storage';
import { db } from './get-db';
import { videoJobs } from '../db/schema';

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
      const posterKey = `${job.key}/${job.key}-poster.0000000.jpg`;
      await database.update(videoJobs)
        .set({
          status: 'ready',
          posterKey,
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

async function checkVideoReady(bucket: BucketLike, key: string): Promise<boolean> {
  const h264Key = `${key}/${key}-h264.mp4`;
  const result = await bucket.head(h264Key);
  return result !== null;
}
