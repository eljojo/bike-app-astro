export const prerender = false;

import type { APIContext } from 'astro';
import { env } from '../../lib/env';
import { deleteMedia } from '../../lib/storage';
import { requireAdmin } from '../../lib/auth';
import { jsonResponse, jsonError } from '../../lib/api-response';

export async function DELETE({ params, locals }: APIContext) {
  // Admin-only: R2 blob deletion is a destructive operation reserved for the
  // storage cleanup tool (C6). Editors/guests remove media from routes by
  // dropping entries from media.yml via the save endpoint — the R2 blob stays.
  try {
    requireAdmin(locals.user);
  } catch {
    return jsonError('Unauthorized', 401);
  }

  const { key } = params;
  if (!key || !/^[0-9a-z]{8}$/.test(key)) {
    return jsonError('Invalid key format');
  }

  try {
    const prefix = env.STORAGE_KEY_PREFIX || '';
    await deleteMedia(env.BUCKET, key, prefix);
    return jsonResponse({ deleted: true, key });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(message, 500);
  }
}
