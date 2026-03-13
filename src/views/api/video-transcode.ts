export const prerender = false;

import type { APIContext } from 'astro';
import { eq } from 'drizzle-orm';
import { env } from '../../lib/env';
import { db } from '../../lib/get-db';
import { videoJobs } from '../../db/schema';
import { createTranscodeService } from '../../lib/transcode-service';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { authorize } from '../../lib/authorize';

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
    const service = createTranscodeService(env);
    const job = await service.createJob({ key, width, height });

    const database = db();
    await database.update(videoJobs)
      .set({
        status: 'transcoding',
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

    return jsonResponse({ jobId: job.jobId, key });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(message, 500);
  }
}
