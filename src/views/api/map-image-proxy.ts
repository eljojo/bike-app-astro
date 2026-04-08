/* eslint-disable bike-app/require-authorize-call -- public map image proxy for og:image and map thumbnails */
/**
 * VENDOR EXCEPTION: This endpoint uses Cloudflare's cf.image transform and
 * caches.default edge cache directly, bypassing the project's vendor-isolation
 * boundary. This is intentional: the image transform is tightly coupled to the
 * CDN edge cache that makes this endpoint fast. A local fallback (direct Google
 * fetch, no transforms) exists for RUNTIME=local development.
 *
 * If migrating away from Cloudflare, replace the cf.image fetch with an image
 * transform proxy (imgproxy, Thumbor, Sharp) and the caches.default calls with
 * your CDN's cache API.
 */
import type { APIRoute } from 'astro';
import { env } from '../../lib/env/env.service';
import {
  MAP_SIZE_PRESETS, parseMapImagePath,
  buildGoogleMapsUrl, buildGoogleMapsUrlFromPolyline, buildGoogleMapsUrlFromPolylines,
  type SlugIndex,
} from './map-image-helpers';
import type { FeatureCollection } from 'geojson';

export const prerender = false;

const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
const isLocal = process.env.RUNTIME === 'local';

export const GET: APIRoute = async ({ params, url, request }) => {
  const rawPath = params.path ?? '';

  // Parse the URL: {type}/{hash}/{slug}-{variant?}-{size}-{lang}.png
  const parsed = parseMapImagePath(rawPath);
  if (!parsed) return new Response('Not found', { status: 404 });

  const { type, hash, slug, size, lang } = parsed;
  const { variant } = parsed;

  const preset = MAP_SIZE_PRESETS[size];
  if (!preset) return new Response('Unknown size', { status: 400 });

  const apiKey = env.GOOGLE_MAPS_STATIC_API_KEY;
  if (!apiKey) return new Response('Map image proxy not configured', { status: 503 });

  // --- Tier 1: Edge cache (Cloudflare only) ---
  if (!isLocal && typeof caches !== 'undefined') {
    // @ts-expect-error — caches.default is Cloudflare Workers API (vendor exception)
    const cache = caches.default as Cache;
    const edgeCached = await cache.match(request);
    if (edgeCached) return edgeCached;
  }

  // --- Load manifest and validate ---
  const assets = env.ASSETS as { fetch: typeof fetch };
  const manifestResult = await loadManifestAndValidate(type, slug, hash, variant, assets, url, apiKey, lang);
  if (manifestResult.error) return manifestResult.error;
  const { googleUrl: rawGoogleUrl } = manifestResult;

  // --- Tier 2: R2 (raw PNG, one per slug+hash+lang) ---
  const r2Key = `maps/${type}/${slug}/${hash}-${lang}.png`;
  const bucket = env.BUCKET;
  const r2Public = env.R2_PUBLIC_URL;
  const r2CdnUrl = `${r2Public}/${r2Key}`;

  const r2Head = await bucket.head(r2Key);
  if (!r2Head) {
    // --- Tier 3: Google (source of truth) ---
    const googleUrlWithLang = rawGoogleUrl.includes('language=') ? rawGoogleUrl : `${rawGoogleUrl}&language=${lang}`;
    const rawResponse = await fetch(googleUrlWithLang);
    if (!rawResponse.ok) return new Response(`Google Maps error: ${rawResponse.status}`, { status: 502 });

    const rawData = await rawResponse.arrayBuffer();

    // Store raw in R2
    await bucket.put(r2Key, rawData);
  }

  // --- Transform via cf.image (Cloudflare) or serve raw (local) ---
  let response: Response;

  if (!isLocal && size !== 'full') {
    // cf.image transforms the R2-hosted raw PNG
    const cfOptions = { ...preset.cfImage, format: 'auto' as const };
    response = await fetch(r2CdnUrl, { cf: { image: cfOptions } } as RequestInit);
    if (!response.ok) {
      // Fallback: serve raw from R2
      const raw = await bucket.get(r2Key);
      if (!raw) return new Response('R2 read failed', { status: 500 });
      response = new Response(await raw.arrayBuffer(), {
        headers: { 'Content-Type': 'image/png' },
      });
    }
  } else {
    // Local dev or 'full' size: serve raw PNG
    const raw = await bucket.get(r2Key);
    if (!raw) return new Response('R2 read failed', { status: 500 });
    response = new Response(await raw.arrayBuffer(), {
      headers: { 'Content-Type': 'image/png' },
    });
  }

  // Build final response with cache headers
  const cacheStatus = r2Head ? 'R2-HIT' : 'MISS';
  const finalResponse = new Response(response.body, {
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'image/png',
      'Cache-Control': IMMUTABLE_CACHE,
      'X-Map-Cache': cacheStatus,
    },
  });

  // --- Put in edge cache (Cloudflare only) ---
  if (!isLocal && typeof caches !== 'undefined') {
    // @ts-expect-error — caches.default is Cloudflare Workers API (vendor exception)
    const cache = caches.default as Cache;
    await cache.put(request, finalResponse.clone()).catch(() => {});
  }

  return finalResponse;
};

// --- Manifest loading and Google URL building ---

interface ManifestResult {
  googleUrl: string;
  error?: never;
}
interface ManifestError {
  googleUrl?: never;
  error: Response;
}

async function loadManifestAndValidate(
  type: string,
  slug: string,
  hash: string,
  variant: string | undefined,
  assets: { fetch: typeof fetch },
  baseUrl: URL,
  apiKey: string,
  _lang: string,
): Promise<ManifestResult | ManifestError> {
  if (type === 'bike-path') {
    return loadBikePathManifest(slug, hash, apiKey, assets, baseUrl);
  } else if (type === 'route') {
    return loadRouteManifest(slug, hash, variant, apiKey, assets, baseUrl);
  } else if (type === 'ride') {
    return loadRideManifest(slug, hash, apiKey, assets, baseUrl);
  } else if (type === 'tour') {
    return loadTourManifest(slug, hash, apiKey, assets, baseUrl);
  }

  return { error: new Response('Unknown type', { status: 404 }) };
}

async function loadBikePathManifest(
  slug: string, hash: string, apiKey: string,
  assets: { fetch: typeof fetch }, baseUrl: URL,
): Promise<ManifestResult | ManifestError> {
  const indexRes = await assets.fetch(new URL('/bike-paths/geo/tiles/slug-index.json', baseUrl.origin));
  if (!indexRes.ok) return { error: new Response('Slug index not found', { status: 404 }) };

  const slugIndex = await indexRes.json() as SlugIndex;
  const entry = slugIndex[slug];
  if (!entry) return { error: new Response('Not found', { status: 404 }) };
  if (entry.hash !== hash) return { error: new Response('Not found', { status: 404 }) };

  const tileData: FeatureCollection[] = [];
  for (const tileId of entry.tiles) {
    const tileRes = await assets.fetch(new URL(`/bike-paths/geo/tiles/tile-${tileId}.geojson`, baseUrl.origin));
    if (tileRes.ok) tileData.push(await tileRes.json() as FeatureCollection);
  }

  const googleUrl = buildGoogleMapsUrl(tileData, slug, 'thumb-lg', apiKey);
  if (!googleUrl) return { error: new Response('No geometry', { status: 404 }) };
  return { googleUrl };
}

async function loadRouteManifest(
  slug: string, hash: string, variant: string | undefined, apiKey: string,
  assets: { fetch: typeof fetch }, baseUrl: URL,
): Promise<ManifestResult | ManifestError> {
  const indexRes = await assets.fetch(new URL('/maps/route-index.json', baseUrl.origin));
  if (!indexRes.ok) return { error: new Response('Route index not found', { status: 404 }) };

  const index = await indexRes.json() as Record<string, { hash: string; variants: Record<string, { hash: string; polyline: string }> }>;
  const entry = index[slug];
  if (!entry) return { error: new Response('Not found', { status: 404 }) };

  // Find the variant matching the hash
  const vKey = variant || Object.keys(entry.variants)[0];
  const variantEntry = entry.variants[vKey];
  if (!variantEntry || variantEntry.hash !== hash) return { error: new Response('Not found', { status: 404 }) };

  const googleUrl = buildGoogleMapsUrlFromPolyline(variantEntry.polyline, apiKey);
  if (!googleUrl) return { error: new Response('No geometry', { status: 404 }) };
  return { googleUrl };
}

async function loadRideManifest(
  slug: string, hash: string, apiKey: string,
  assets: { fetch: typeof fetch }, baseUrl: URL,
): Promise<ManifestResult | ManifestError> {
  const indexRes = await assets.fetch(new URL('/maps/ride-index.json', baseUrl.origin));
  if (!indexRes.ok) return { error: new Response('Ride index not found', { status: 404 }) };

  const index = await indexRes.json() as Record<string, { hash: string; polyline: string }>;
  const entry = index[slug];
  if (!entry || entry.hash !== hash) return { error: new Response('Not found', { status: 404 }) };

  const googleUrl = buildGoogleMapsUrlFromPolyline(entry.polyline, apiKey);
  if (!googleUrl) return { error: new Response('No geometry', { status: 404 }) };
  return { googleUrl };
}

async function loadTourManifest(
  slug: string, hash: string, apiKey: string,
  assets: { fetch: typeof fetch }, baseUrl: URL,
): Promise<ManifestResult | ManifestError> {
  const indexRes = await assets.fetch(new URL('/maps/tour-index.json', baseUrl.origin));
  if (!indexRes.ok) return { error: new Response('Tour index not found', { status: 404 }) };

  const index = await indexRes.json() as Record<string, { hash: string; rides: string[]; polylines: string[] }>;
  const entry = index[slug];
  if (!entry || entry.hash !== hash) return { error: new Response('Not found', { status: 404 }) };

  const googleUrl = buildGoogleMapsUrlFromPolylines(entry.polylines, apiKey);
  if (!googleUrl) return { error: new Response('No geometry', { status: 404 }) };
  return { googleUrl };
}
