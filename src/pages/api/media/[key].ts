export const prerender = false;

import type { APIContext } from 'astro';
import { deleteMedia } from '../../../lib/storage';

export async function DELETE({ params, locals }: APIContext) {
  const { key } = params;
  if (!key || typeof key !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing or invalid key' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const env = (locals as any).runtime.env;
    await deleteMedia(env.R2, key);
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
