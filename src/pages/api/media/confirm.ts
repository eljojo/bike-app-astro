export const prerender = false;

import type { APIContext } from 'astro';
import { confirmUpload } from '../../../lib/storage';

export async function POST({ request, locals }: APIContext) {
  let body: { key?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { key } = body;
  if (!key || typeof key !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing or invalid key' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const env = (locals as any).runtime.env;
    const metadata = await confirmUpload(env.R2, key);
    return new Response(JSON.stringify(metadata), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
