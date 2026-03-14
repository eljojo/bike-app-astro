export const prerender = false;

/**
 * Process pending video transcoding jobs.
 *
 * Checks all jobs with status 'transcoding', updates completed ones to 'ready',
 * and marks stale ones (>2h) as 'failed'. Intended to be called periodically
 * by Cloudflare Cron Triggers (with CRON_SECRET) or manually by an admin.
 *
 * POST /api/video/cron
 */

import type { APIContext } from 'astro';
import { env } from '../../lib/env/env.service';
import { processPendingVideos } from '../../lib/video-completion';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { authorize } from '../../lib/authorize';

export async function POST({ request, locals }: APIContext) {
  // Accept either a cron secret token or an admin session
  const authHeader = request.headers.get('Authorization');
  const cronSecret = env.CRON_SECRET;
  const isCronAuth = cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!isCronAuth) {
    const auth = authorize(locals, 'manage-users');
    if (auth instanceof Response) return auth;
  }

  try {
    const result = await processPendingVideos(env);
    return jsonResponse(result as unknown as Record<string, unknown>);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(message, 500);
  }
}
