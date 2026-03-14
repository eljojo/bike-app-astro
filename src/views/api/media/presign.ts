export const prerender = false;

import type { APIContext } from 'astro';
import { env } from '../../../lib/env/env.service';
import { db } from '../../../lib/get-db';
import { generateMediaKey, createPresignedUploadUrl } from '../../../lib/storage';
import { jsonResponse, jsonError } from '../../../lib/api-response';
import { authorize } from '../../../lib/auth/authorize';
import { checkRateLimit, recordAttempt, cleanupOldAttempts, LIMITS } from '../../../lib/auth/rate-limit';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

export async function POST({ request, locals }: APIContext) {
  const auth = authorize(locals, 'upload-media');
  if (auth instanceof Response) return auth;

  let body: { contentType?: string; contentLength?: number };
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body');
  }

  const { contentType } = body;
  if (!contentType || !ALLOWED_TYPES.includes(contentType)) {
    return jsonError(`Invalid content type. Allowed: ${ALLOWED_TYPES.join(', ')}`);
  }

  const MAX_UPLOAD_SIZE = 25 * 1024 * 1024; // 25MB
  if (body.contentLength && body.contentLength > MAX_UPLOAD_SIZE) {
    return jsonError('File too large. Maximum size is 25MB.', 413);
  }

  const role: string = auth.role;
  const limit = LIMITS[role];

  if (limit != null) {
    const database = db();
    const ip = request.headers.get('cf-connecting-ip')
      || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || 'unknown';

    const identifiers = [`user:${auth.id}`, `ip:${ip}`];
    const overLimit = await checkRateLimit(database, 'presign', identifiers, limit);

    if (overLimit) {
      return jsonError('Upload rate limit exceeded', 429);
    }

    await recordAttempt(database, 'presign', identifiers);

    // Clean up old rows (fire-and-forget)
    cleanupOldAttempts(database, 'presign').catch(() => {});
  }

  try {
    const prefix = env.STORAGE_KEY_PREFIX || '';
    const key = await generateMediaKey(env.BUCKET, prefix);

    let uploadUrl: string;
    if (!env.R2_ACCESS_KEY_ID) {
      // Local dev: use direct upload endpoint (no R2 credentials available)
      uploadUrl = `/api/dev/upload?key=${key}&contentType=${encodeURIComponent(contentType)}`;
    } else {
      uploadUrl = await createPresignedUploadUrl(env, key, contentType);
    }

    return jsonResponse({ key, uploadUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(message, 500);
  }
}
