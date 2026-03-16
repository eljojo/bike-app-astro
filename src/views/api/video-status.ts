export const prerender = false;

import type { APIContext } from 'astro';
import { eq } from 'drizzle-orm';
import { db } from '../../lib/get-db';
import { videoJobs } from '../../db/schema';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { authorize } from '../../lib/auth/authorize';
import { h264OutputKey, posterKeyForVideo } from '../../lib/media/video-completion';
import { getCityConfig } from '../../lib/config/city-config';

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

  // Self-healing: if webhook was missed, check videos CDN for transcoded output
  try {
    const videosCdn = getCityConfig().videos_cdn_url;
    const h264Url = `${videosCdn}/${h264OutputKey(key)}`;
    const res = await fetch(h264Url, { method: 'HEAD' });
    if (res.ok) {
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
  } catch {
    // CDN check failed — continue with current status
  }

  return jsonResponse(job as unknown as Record<string, unknown>);
}
