export const prerender = false;

import type { APIContext } from 'astro';
import { eq } from 'drizzle-orm';
import { env } from '../../lib/env/env.service';
import { db } from '../../lib/get-db';
import { videoJobs } from '../../db/schema';
import { createTranscodeService } from '../../lib/transcode-service';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { authorize } from '../../lib/auth/authorize';

export async function POST({ request, locals }: APIContext) {
  const auth = authorize(locals, 'upload-media');
  if (auth instanceof Response) return auth;

  let body: {
    key?: string;
    width?: number;
    height?: number;
    duration?: string;
    capturedAt?: string;
    lat?: number;
    lng?: number;
    title?: string;
    handle?: string;
  };
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body');
  }

  const { key, width, height, duration, capturedAt, lat, lng, title, handle } = body;

  if (!key) return jsonError('Missing key');
  if (!width || !height) return jsonError('Missing dimensions');

  try {
    // Verify the key exists in video_jobs and is in 'uploading' status
    const database = db();
    const existing = await database
      .select({ status: videoJobs.status })
      .from(videoJobs)
      .where(eq(videoJobs.key, key))
      .get();

    if (!existing) {
      return jsonError('Video job not found. Call presign first.', 404);
    }
    if (existing.status !== 'uploading') {
      return jsonError(`Video job is in '${existing.status}' state, expected 'uploading'`, 409);
    }

    const service = await createTranscodeService(env);
    const job = await service.createJob({ key, width, height });

    const isLocal = job.jobId.startsWith('local-');
    await database.update(videoJobs)
      .set({
        status: isLocal ? 'ready' : 'transcoding',
        jobId: job.jobId,
        width,
        height,
        duration,
        orientation: width > height ? 'landscape' : 'portrait',
        capturedAt,
        lat,
        lng,
        title,
        handle,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(videoJobs.key, key));

    return jsonResponse({ jobId: job.jobId, key, status: isLocal ? 'ready' : 'transcoding' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(message, 500);
  }
}
