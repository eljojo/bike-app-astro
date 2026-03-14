export const prerender = false;

import type { APIContext } from 'astro';
import { eq } from 'drizzle-orm';
import { env } from '../../lib/env/env.service';
import { db } from '../../lib/get-db';
import { videoJobs } from '../../db/schema';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { authorize } from '../../lib/auth/authorize';
import { checkVideoReady, posterKeyForVideo } from '../../lib/video-completion';

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
    const posterKey = posterKeyForVideo(key);
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
