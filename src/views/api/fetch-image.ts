import type { APIContext } from 'astro';
import { env } from '../../lib/env';
import { authorize } from '../../lib/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';

export const prerender = false;

const MAX_SIZE = 25 * 1024 * 1024; // 25MB, same as regular uploads
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export async function POST({ request, locals }: APIContext) {
  const user = authorize(locals, 'upload-media');
  if (user instanceof Response) return user;

  try {
    const { url } = await request.json() as { url: string };
    if (!url) return jsonError('url required', 400);

    // Validate URL
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return jsonError('Invalid URL', 400);
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return jsonError('URL must be http or https', 400);
    }

    // Fetch the image
    const imageResponse = await fetch(url, {
      headers: { 'Accept': 'image/*' },
    });
    if (!imageResponse.ok) {
      return jsonError(`Failed to fetch image: ${imageResponse.status}`, 502);
    }

    const contentType = imageResponse.headers.get('content-type') || '';
    if (!ALLOWED_TYPES.some(t => contentType.startsWith(t))) {
      return jsonError(`Not an image (got ${contentType})`, 400);
    }

    const contentLength = Number(imageResponse.headers.get('content-length') || 0);
    if (contentLength > MAX_SIZE) {
      return jsonError(`Image too large (${(contentLength / 1024 / 1024).toFixed(1)}MB, max 25MB)`, 400);
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    if (imageBuffer.byteLength > MAX_SIZE) {
      return jsonError('Image too large (max 25MB)', 400);
    }

    // Generate a unique key
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const prefix = env.STORAGE_KEY_PREFIX || '';
    const key = `${prefix}uploads/${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}.${ext}`;

    // Upload to bucket
    await env.BUCKET.put(key, imageBuffer);

    return jsonResponse({ key, contentType });
  } catch (err: unknown) {
    console.error('Fetch image error:', err);
    const message = err instanceof Error ? err.message : 'Failed to fetch image';
    return jsonError(message, 500);
  }
}
