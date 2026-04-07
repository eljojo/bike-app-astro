/* eslint-disable bike-app/require-authorize-call -- public commons image proxy */
import type { APIRoute } from 'astro';
import { tileCache } from '../../lib/env/env.service';
import { buildCommonsUrl, commonsContentType } from './commons-image-helpers';

export const prerender = false;

const CACHE_TTL = 30 * 24 * 60 * 60; // 30 days in seconds

/** Only allow filenames with safe characters. */
const ALLOWED_FILENAME = /^[\w\s\-.()+,;'!]+$/;

export const GET: APIRoute = async ({ params }) => {
  const filename = params.path;
  if (!filename || !ALLOWED_FILENAME.test(filename)) return new Response('Not found', { status: 404 });

  // Check cache
  const cacheKey = `commons:${filename}`;
  const cached = await tileCache.get(cacheKey);
  if (cached) {
    return new Response(cached, {
      headers: {
        'Content-Type': commonsContentType(filename),
        'Cache-Control': 'public, max-age=86400',
        'X-Commons-Cache': 'HIT',
      },
    });
  }

  // Fetch from Wikimedia Commons
  const url = buildCommonsUrl(filename);
  const upstream = await fetch(url, {
    headers: { 'User-Agent': 'whereto.bike/1.0 (https://ottawabybike.ca)' },
    redirect: 'follow',
  });
  if (!upstream.ok) {
    return new Response(`Upstream error: ${upstream.status}`, { status: upstream.status });
  }

  const data = await upstream.arrayBuffer();

  // Use upstream Content-Type when available, fall back to extension-based guess
  const contentType = upstream.headers.get('Content-Type') || commonsContentType(filename);

  // Cache the response (fire-and-forget)
  tileCache.put(cacheKey, data, CACHE_TTL).catch(() => {});

  return new Response(data, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
      'X-Commons-Cache': 'MISS',
    },
  });
};
