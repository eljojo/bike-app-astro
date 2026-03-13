export const prerender = false;

import type { APIContext } from 'astro';
import { eq } from 'drizzle-orm';
import { env } from '../../lib/env';
import { db } from '../../lib/get-db';
import { videoJobs } from '../../db/schema';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { authorize } from '../../lib/authorize';
import type { BucketLike } from '../../lib/storage';

export async function GET({ params, locals }: APIContext) {
  const auth = authorize(locals, 'upload-media');
  if (auth instanceof Response) return auth;

  const key = params.key;
  if (!key) return jsonError('Missing key');

  const database = db();
  const job = await database.select().from(videoJobs).where(eq(videoJobs.key, key)).get();
  if (!job) return jsonError('Not found', 404);

  if (job.status === 'ready' || job.status === 'failed') {
    return jsonResponse(job as unknown as Record<string, unknown>);
  }

  // Check R2/bucket for transcoded output files
  const ready = await checkVideoReady(env.BUCKET, key);

  if (ready) {
    const posterKey = `${key}/${key}-poster.0000000.jpg`;
    await database.update(videoJobs)
      .set({
        status: 'ready',
        posterKey,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(videoJobs.key, key));

    return jsonResponse({
      ...(job as unknown as Record<string, unknown>),
      status: 'ready',
      posterKey,
    });
  }

  return jsonResponse(job as unknown as Record<string, unknown>);
}

/**
 * Check whether the H.264 output file exists in the bucket.
 * MediaConvert writes outputs to {key}/{key}-h264.mp4.
 */
async function checkVideoReady(bucket: BucketLike, key: string): Promise<boolean> {
  const h264Key = `${key}/${key}-h264.mp4`;
  const result = await bucket.head(h264Key);
  return result !== null;
}
