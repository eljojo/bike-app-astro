import type { APIRoute } from 'astro';
import { env, tileCache } from '../../lib/env';
import { buildThunderforestUrl, contentTypeForPath } from '../../lib/tile-proxy-helpers';

export const prerender = false;

const CACHE_TTL = 30 * 24 * 60 * 60; // 30 days in seconds

export const ALL: APIRoute = async ({ params }) => {
  const tilePath = params.path;
  if (!tilePath) return new Response('Not found', { status: 404 });

  const apiKey = env.THUNDERFOREST_API_KEY;
  if (!apiKey) return new Response('Tile proxy not configured', { status: 503 });

  // Check cache
  const cached = await tileCache.get(tilePath);
  if (cached) {
    return new Response(cached, {
      headers: {
        'Content-Type': contentTypeForPath(tilePath),
        'Cache-Control': 'public, max-age=86400',
        'X-Tile-Cache': 'HIT',
      },
    });
  }

  // Fetch from Thunderforest
  const url = buildThunderforestUrl(tilePath, apiKey);
  const upstream = await fetch(url);
  if (!upstream.ok) {
    return new Response(`Upstream error: ${upstream.status}`, { status: upstream.status });
  }

  const data = await upstream.arrayBuffer();

  // Cache the response (fire-and-forget)
  tileCache.put(tilePath, data, CACHE_TTL).catch(() => {});

  return new Response(data, {
    headers: {
      'Content-Type': contentTypeForPath(tilePath),
      'Cache-Control': 'public, max-age=86400',
      'X-Tile-Cache': 'MISS',
    },
  });
};
