export const prerender = false;

import type { APIContext } from 'astro';
import { env } from '../../../lib/env';
import { confirmUpload } from '../../../lib/storage';
import { authorize } from '../../../lib/authorize';
import { jsonResponse, jsonError } from '../../../lib/api-response';

export async function POST({ request, locals }: APIContext) {
  const user = authorize(locals, 'upload-media');
  if (user instanceof Response) return user;

  let body: { key?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body');
  }

  const { key } = body;
  if (!key || typeof key !== 'string') {
    return jsonError('Missing or invalid key');
  }

  try {
    const prefix = env.STORAGE_KEY_PREFIX || '';
    const metadata = await confirmUpload(env.BUCKET, key, prefix);
    return jsonResponse(metadata as unknown as Record<string, unknown>);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(message, 404);
  }
}
