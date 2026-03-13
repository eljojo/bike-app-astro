export const prerender = false;

import type { APIContext } from 'astro';
import { env } from '../../lib/env';
import { db } from '../../lib/get-db';
import { videoJobs } from '../../db/schema';
import { createTranscodeService } from '../../lib/transcode-service';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { authorize } from '../../lib/authorize';

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

  try {
    const key = crypto.randomUUID().replaceAll('-', '').slice(0, 24);
    const service = createTranscodeService(env);
    const uploadUrl = await service.presignUpload(key, contentType);

    const database = db();
    await database.insert(videoJobs).values({
      key,
      contentType: contentKind || 'route',
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
