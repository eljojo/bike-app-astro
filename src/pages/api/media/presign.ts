export const prerender = false;

import type { APIContext } from 'astro';
import { generateMediaKey, createPresignedUploadUrl } from '../../../lib/storage';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

export async function POST({ request, locals }: APIContext) {
  let body: { contentType?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { contentType } = body;
  if (!contentType || !ALLOWED_TYPES.includes(contentType)) {
    return new Response(
      JSON.stringify({
        error: `Invalid content type. Allowed: ${ALLOWED_TYPES.join(', ')}`,
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  try {
    const env = locals.runtime.env;
    const key = await generateMediaKey(env.R2);
    const uploadUrl = await createPresignedUploadUrl(env, key, contentType);

    return new Response(JSON.stringify({ key, uploadUrl }), {
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
