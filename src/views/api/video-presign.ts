export const prerender = false;

import type { APIContext } from 'astro';
import { env } from '../../lib/env/env.service';
import { db } from '../../lib/get-db';
import { videoJobs } from '../../db/schema';
import { createTranscodeService, type TranscodeService } from '../../lib/media/transcode.service';
import { randomKey } from '../../lib/media/storage.adapter-r2';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { authorize } from '../../lib/auth/authorize';
import { checkRateLimit, recordAttempt, cleanupOldAttempts, LIMITS } from '../../lib/auth/rate-limit';

/**
 * Generate a unique 8-char key, checking S3 for collisions.
 * Mirrors generateMediaKey() from storage.ts (which checks R2).
 */
async function generateVideoKey(service: TranscodeService): Promise<string> {
  const maxAttempts = 10;
  for (let i = 0; i < maxAttempts; i++) {
    const key = randomKey();
    const exists = await service.headObject(key);
    if (!exists) return key;
  }
  throw new Error('Failed to generate unique video key after maximum attempts');
}

const ALLOWED_VIDEO_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
];
const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500MB

export async function POST({ request, locals }: APIContext) {
  const auth = authorize(locals, 'upload-media');
  if (auth instanceof Response) return auth;

  let body: {
    contentType?: string;
    contentLength?: number;
    contentSlug?: string;
    contentKind?: string;
    filename?: string;
  };
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body');
  }

  const { contentType, contentLength, contentSlug, contentKind, filename } = body;

  if (!contentType || !ALLOWED_VIDEO_TYPES.includes(contentType)) {
    return jsonError(`Invalid video type. Allowed: ${ALLOWED_VIDEO_TYPES.join(', ')}`);
  }
  if (contentLength && contentLength > MAX_VIDEO_SIZE) {
    return jsonError('Video too large. Maximum 500MB.', 413);
  }
  if (!contentSlug) {
    return jsonError('Missing contentSlug');
  }

  const ALLOWED_CONTENT_KINDS = ['route', 'ride'];
  const validKind = ALLOWED_CONTENT_KINDS.includes(contentKind || '') ? contentKind! : 'route';

  // Rate limit video presigns (same mechanism as photo uploads)
  const role: string = auth.role;
  const limit = LIMITS[role];
  if (limit != null) {
    const database = db();
    const ip = request.headers.get('cf-connecting-ip')
      || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || 'unknown';
    const identifiers = [`user:${auth.id}`, `ip:${ip}`];
    const overLimit = await checkRateLimit(database, 'video-presign', identifiers, limit);
    if (overLimit) {
      return jsonError('Video upload rate limit exceeded', 429);
    }
    await recordAttempt(database, 'video-presign', identifiers);
    cleanupOldAttempts(database, 'video-presign').catch(() => {});
  }

  try {
    const service = await createTranscodeService(env);
    const key = await generateVideoKey(service);
    const uploadUrl = await service.presignUpload(key, contentType);

    const database = db();
    await database.insert(videoJobs).values({
      key,
      contentKind: validKind,
      contentSlug,
      status: 'uploading',
      title: filename?.replace(/\.[^.]+$/, '') || undefined,
    });

    return jsonResponse({ key, uploadUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(message, 500);
  }
}
