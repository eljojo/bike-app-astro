// eslint-disable-next-line bike-app/require-authorize-call -- bearer token auth from Lambda, not session-based
export const prerender = false;

import type { APIContext } from 'astro';
import { eq } from 'drizzle-orm';
import { env } from '../../lib/env/env.service';
import { db } from '../../lib/get-db';
import { videoJobs } from '../../db/schema';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { persistVideoMetadataToGit } from '../../lib/media/video-completion.webhook';

export async function POST({ request }: APIContext) {
  // Auth: bearer token, NOT session-based (Lambda calls this)
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token || token !== env.WEBHOOK_SECRET) {
    return jsonError('Unauthorized', 401);
  }

  const body = await request.json();
  const { key, status, width, height, duration, orientation, capturedAt, lat, lng, jobId } = body;

  if (!key || !status) return jsonError('Missing key or status');

  const database = db();
  const existing = await database.select().from(videoJobs).where(eq(videoJobs.key, key)).get();
  if (!existing) return jsonError('Video job not found', 404);

  const updates: Record<string, unknown> = {
    status,
    updatedAt: new Date().toISOString(),
  };
  if (width != null) updates.width = width;
  if (height != null) updates.height = height;
  if (duration != null) updates.duration = duration;
  if (orientation != null) updates.orientation = orientation;
  if (capturedAt != null) updates.capturedAt = capturedAt;
  if (lat != null) updates.lat = lat;
  if (lng != null) updates.lng = lng;
  if (jobId != null) updates.jobId = jobId;

  await database.update(videoJobs).set(updates).where(eq(videoJobs.key, key));

  // If status is 'ready', try to persist metadata to git
  if (status === 'ready') {
    try {
      const result = await persistVideoMetadataToGit(key);
      return jsonResponse({ ok: true, persisted: result.persisted, reason: result.reason });
    } catch (err) {
      // Git persistence failed — row stays in D1 for the save pipeline to pick up
      console.error('Video metadata git persistence failed:', err);
      return jsonResponse({ ok: true, persisted: false, reason: 'Git commit failed — will retry on next save' });
    }
  }

  return jsonResponse({ ok: true });
}
