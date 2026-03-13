export const prerender = false;

import type { APIContext } from 'astro';
import { jsonError } from '../../lib/api-response';
import { authorize } from '../../lib/authorize';

export async function PUT({ request, url, locals }: APIContext) {
  const auth = authorize(locals, 'upload-media');
  if (auth instanceof Response) return auth;

  if (process.env.RUNTIME !== 'local') {
    return new Response('Not available', { status: 404 });
  }

  const key = url.searchParams.get('key');
  if (!key) {
    return jsonError('Missing key');
  }

  try {
    const { env } = await import('../../lib/env');
    const body = await request.arrayBuffer();
    await env.BUCKET.put(key, body);

    return new Response(null, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(message, 500);
  }
}
