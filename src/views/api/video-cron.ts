export const prerender = false;

/**
 * Process pending video transcoding jobs.
 *
 * Checks all jobs with status 'transcoding', updates completed ones to 'ready',
 * and marks stale ones (>2h) as 'failed'. Intended to be called periodically.
 *
 * POST /api/video/cron
 */

import type { APIContext } from 'astro';
import { env } from '../../lib/env';
import { processPendingVideos } from '../../lib/video-completion';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { authorize } from '../../lib/authorize';

export async function POST({ locals }: APIContext) {
  const auth = authorize(locals, 'upload-media');
  if (auth instanceof Response) return auth;

  try {
    const result = await processPendingVideos(env);
    return jsonResponse(result as unknown as Record<string, unknown>);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(message, 500);
  }
}
