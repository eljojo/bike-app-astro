export const prerender = false;

import type { APIContext } from 'astro';
import { jsonError } from '../../lib/api-response';
import { authorize } from '../../lib/auth/authorize';

export async function PUT({ request, url, locals }: APIContext) {
  const auth = authorize(locals, 'upload-media');
  if (auth instanceof Response) return auth;

  if (process.env.RUNTIME !== 'local') {
    return new Response('Not available', { status: 404 });
  }

  const key = url.searchParams.get('key');
  if (!key || !/^([a-z0-9]+\/)?[a-z0-9]{8}$/.test(key)) {
    return jsonError('Invalid key format');
  }

  try {
    const { env } = await import('../../lib/env/env.service');
    const body = await request.arrayBuffer();
    await env.BUCKET.put(key, body);

    return new Response(null, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(message, 500);
  }
}
