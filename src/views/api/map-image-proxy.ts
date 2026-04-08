/* eslint-disable bike-app/require-authorize-call -- public map image proxy for og:image social cards */
import type { APIRoute } from 'astro';
import { env, tileCache } from '../../lib/env/env.service';
import { MAP_SIZE_PRESETS, buildGoogleMapsUrl, type SlugIndex } from './map-image-helpers';
import type { FeatureCollection } from 'geojson';

export const prerender = false;

const CACHE_TTL = 90 * 24 * 60 * 60; // 90 days
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
const ALLOWED_SLUG = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export const GET: APIRoute = async ({ params, url }) => {
  const rawPath = params.path ?? '';
  // Expected: "bike-path/{slug}"
  const parts = rawPath.split('/');
  if (parts.length !== 2 || parts[0] !== 'bike-path') {
    return new Response('Not found', { status: 404 });
  }

  const slug = parts[1];
  if (!slug || !ALLOWED_SLUG.test(slug)) {
    return new Response('Not found', { status: 404 });
  }

  const sizeName = url.searchParams.get('size');
  if (!sizeName || !MAP_SIZE_PRESETS[sizeName]) {
    return new Response('Missing or unknown size parameter', { status: 400 });
  }

  const hash = url.searchParams.get('h');
  if (!hash) {
    return new Response('Missing h (hash) parameter', { status: 400 });
  }

  const apiKey = env.GOOGLE_MAPS_STATIC_API_KEY;
  if (!apiKey) {
    return new Response('Map image proxy not configured', { status: 503 });
  }

  // Check KV cache
  const cacheKey = `gmap:bike-path:${slug}:${sizeName}:${hash}`;
  const cached = await tileCache.get(cacheKey);
  if (cached) {
    return new Response(cached, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': IMMUTABLE_CACHE,
        'X-Map-Cache': 'HIT',
      },
    });
  }

  // Read slug index
  const assets = env.ASSETS as { fetch: typeof fetch };
  const indexUrl = new URL('/bike-paths/geo/tiles/slug-index.json', url.origin);
  const indexRes = await assets.fetch(indexUrl);
  if (!indexRes.ok) {
    return new Response('Slug index not found', { status: 404 });
  }
  const slugIndex = await indexRes.json() as SlugIndex;
  const entry = slugIndex[slug];
  if (!entry) {
    return new Response('Not found', { status: 404 });
  }

  // Validate hash matches current geometry
  if (entry.hash !== hash) {
    return new Response('Not found', { status: 404 });
  }

  // Fetch tile GeoJSONs
  const tileData: FeatureCollection[] = [];
  for (const tileId of entry.tiles) {
    const tileUrl = new URL(`/bike-paths/geo/tiles/tile-${tileId}.geojson`, url.origin);
    const tileRes = await assets.fetch(tileUrl);
    if (tileRes.ok) {
      tileData.push(await tileRes.json() as FeatureCollection);
    }
  }

  // Build Google Static Maps URL
  const googleUrl = buildGoogleMapsUrl(tileData, slug, sizeName, apiKey);
  if (!googleUrl) {
    return new Response('No geometry for slug', { status: 404 });
  }

  // Fetch from Google
  const upstream = await fetch(googleUrl);
  if (!upstream.ok) {
    return new Response(`Upstream error: ${upstream.status}`, { status: 502 });
  }

  const data = await upstream.arrayBuffer();

  // Cache (fire-and-forget)
  tileCache.put(cacheKey, data, CACHE_TTL).catch(() => {});

  return new Response(data, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': IMMUTABLE_CACHE,
      'X-Map-Cache': 'MISS',
    },
  });
};
