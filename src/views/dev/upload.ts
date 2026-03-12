export const prerender = false;

import type { APIContext } from 'astro';
import { jsonResponse, jsonError } from '../../lib/api-response';

export async function PUT({ request, url }: APIContext) {
  if (process.env.RUNTIME !== 'local') {
    return new Response('Not available', { status: 404 });
  }

  const key = url.searchParams.get('key');
  if (!key) {
    return jsonError('Missing key');
  }

  try {
    const { env } = await import('../../lib/env');
    const prefix = env.STORAGE_KEY_PREFIX || '';
    const body = await request.arrayBuffer();
    await env.BUCKET.put(`${prefix}uploads/pending/${key}`, body);

    return jsonResponse({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(message, 500);
  }
}
