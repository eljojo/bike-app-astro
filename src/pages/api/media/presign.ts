export const prerender = false;

import type { APIContext } from 'astro';
import { env } from '../../../lib/env';
import { generateMediaKey, createPresignedUploadUrl } from '../../../lib/storage';
import { jsonResponse, jsonError } from '../../../lib/api-response';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

export async function POST({ request, locals }: APIContext) {
  let body: { contentType?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body');
  }

  const { contentType } = body;
  if (!contentType || !ALLOWED_TYPES.includes(contentType)) {
    return jsonError(`Invalid content type. Allowed: ${ALLOWED_TYPES.join(', ')}`);
  }

  // TODO: add rate limiting for guest uploads (max 10 per hour)
  // For v1, trust UI friction (auth gate + drag-and-drop)

  try {
    const prefix = env.STORAGE_KEY_PREFIX || '';
    const key = await generateMediaKey(env.BUCKET, prefix);
    const uploadUrl = await createPresignedUploadUrl(env, key, contentType);

    return jsonResponse({ key, uploadUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(message, 500);
  }
}
