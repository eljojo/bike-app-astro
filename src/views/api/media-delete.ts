export const prerender = false;

import type { APIContext } from 'astro';
import { env } from '../../lib/env';
import { deleteMedia } from '../../lib/storage';

export async function DELETE({ params, locals }: APIContext) {
  const user = locals.user;
  if (!user || user.role === 'guest') {
    return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { key } = params;
  if (!key || !/^[0-9a-z]{8}$/.test(key)) {
    return new Response(JSON.stringify({ error: 'Invalid key format' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const prefix = env.STORAGE_KEY_PREFIX || '';
    await deleteMedia(env.BUCKET, key, prefix);
    return new Response(JSON.stringify({ deleted: true, key }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
