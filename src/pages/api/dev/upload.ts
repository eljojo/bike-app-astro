export const prerender = false;

import type { APIContext } from 'astro';

export async function PUT({ request, url }: APIContext) {
  if (process.env.RUNTIME !== 'local') {
    return new Response('Not available', { status: 404 });
  }

  const key = url.searchParams.get('key');
  if (!key) {
    return new Response(JSON.stringify({ error: 'Missing key' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { env } = await import('../../../lib/env');
    const body = await request.arrayBuffer();
    await env.BUCKET.put(`uploads/pending/${key}`, body);

    return new Response(JSON.stringify({ success: true }), {
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
