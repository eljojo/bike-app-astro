import type { APIContext } from 'astro';
import { env } from '../../lib/env';
import { authorize } from '../../lib/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { generateMediaKey, confirmUpload } from '../../lib/storage';

export const prerender = false;

const MAX_SIZE = 25 * 1024 * 1024; // 25MB, same as regular uploads
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export async function POST({ request, locals }: APIContext) {
  const user = authorize(locals, 'upload-media');
  if (user instanceof Response) return user;

  if (!env.BUCKET) {
    return jsonError('Storage not configured', 500);
  }

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

    // Cloudflare Workers' outbound fetch() routes through Cloudflare's network and
    // cannot reach private/internal IP ranges (169.254.x.x, 10.x.x.x, etc.),
    // providing built-in SSRF protection. No explicit IP blocking needed.
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

    // Stage to pending, validate image headers, then promote — same as direct uploads
    const prefix = env.STORAGE_KEY_PREFIX || '';
    const key = await generateMediaKey(env.BUCKET, prefix);
    const pendingKey = `${prefix}uploads/pending/${key}`;
    await env.BUCKET.put(pendingKey, imageBuffer);

    const result = await confirmUpload(env.BUCKET, key, prefix);

    return jsonResponse({ key: result.key, contentType: result.contentType });
  } catch (err: unknown) {
    console.error('Fetch image error:', err);
    const message = err instanceof Error ? err.message : 'Failed to fetch image';
    return jsonError(message, 500);
  }
}
