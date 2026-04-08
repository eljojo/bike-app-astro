import polylineCodec from '@mapbox/polyline';
import { mergeAdjacentSegments } from '../../lib/geo/merge-segments';
import type { FeatureCollection, Feature, LineString, MultiLineString } from 'geojson';

export interface SlugIndex {
  [slug: string]: { tiles: string[]; hash: string };
}

export interface SizePreset {
  /** cf.image transform options (Cloudflare production) */
  cfImage: { width?: number; height?: number; fit?: string; quality?: number };
  /** Google Static Maps size param (local dev fallback) */
  googleSize: string;
  googleScale: number;
}

export const MAP_SIZE_PRESETS: Record<string, SizePreset> = {
  social:     { cfImage: { width: 1200, height: 630, fit: 'cover', quality: 85 },   googleSize: '600x315', googleScale: 2 },
  thumb:      { cfImage: { width: 375, fit: 'scale-down', quality: 80 },             googleSize: '375x375', googleScale: 1 },
  'thumb-2x': { cfImage: { width: 750, fit: 'scale-down', quality: 80 },             googleSize: '400x400', googleScale: 2 },
  'thumb-lg': { cfImage: { width: 1500, fit: 'scale-down', quality: 80 },            googleSize: '800x800', googleScale: 2 },
  full:       { cfImage: {},                                                          googleSize: '800x800', googleScale: 2 },
};

/** Adaptively sample points until the encoded polyline fits within maxChars. */
function sampleToFit(points: [number, number][], maxChars: number): string {
  let interval = 5;
  let encoded: string;
  do {
    const sampled = points.filter((_, i) => i % interval === 0);
    if (sampled[sampled.length - 1] !== points[points.length - 1]) sampled.push(points[points.length - 1]);
    encoded = polylineCodec.encode(sampled);
    if (encoded.length <= maxChars) return encoded;
    interval = Math.ceil(interval * 1.5);
  } while (interval < points.length);
  return encoded!;
}

/**
 * Build a Google Static Maps URL from tile GeoJSON data for a specific slug.
 * Filters features by slug, deduplicates by _fid, encodes polylines.
 * Returns null if no geometry found for the slug.
 */
export function buildGoogleMapsUrl(
  tileData: FeatureCollection[],
  slug: string,
  sizeName: string,
  apiKey: string,
  language?: string,
): string | null {
  const preset = MAP_SIZE_PRESETS[sizeName];
  if (!preset) return null;

  const seenFids = new Set<string>();
  const segments: [number, number][][] = [];

  for (const fc of tileData) {
    for (const feature of fc.features) {
      if ((feature.properties as Record<string, unknown>)?.slug !== slug) continue;
      const fid = (feature.properties as Record<string, unknown>)?._fid as string;
      if (fid && seenFids.has(fid)) continue;
      if (fid) seenFids.add(fid);
      extractSegments(feature, segments);
    }
  }

  if (segments.length === 0) return null;

  const merged = mergeAdjacentSegments(segments, 0.1);

  const params = new URLSearchParams({
    maptype: 'roadmap',
    size: preset.googleSize,
    scale: String(preset.googleScale),
    key: apiKey,
    ...(language && { language }),
  });

  let url = `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
  const MAX_URL = 16384;
  const BUFFER = 200;
  const PATH_PREFIX = '&path=enc:';

  const sorted = [...merged].sort((a, b) => b.length - a.length);
  for (const segment of sorted) {
    const available = MAX_URL - url.length - PATH_PREFIX.length - BUFFER;
    if (available < 50) break;
    url += `${PATH_PREFIX}${sampleToFit(segment, available)}`;
  }

  return url;
}

function extractSegments(feature: Feature, out: [number, number][][]): void {
  const geom = feature.geometry as LineString | MultiLineString | null;
  if (!geom) return;
  if (geom.type === 'LineString') {
    const coords = geom.coordinates.map(c => [c[1], c[0]] as [number, number]);
    if (coords.length >= 2) out.push(coords);
  } else if (geom.type === 'MultiLineString') {
    for (const line of geom.coordinates) {
      const coords = line.map(c => [c[1], c[0]] as [number, number]);
      if (coords.length >= 2) out.push(coords);
    }
  }
}

/**
 * Build a Google Static Maps URL from a pre-encoded polyline string.
 * Used for routes and rides (GPX-based geometry).
 */
export function buildGoogleMapsUrlFromPolyline(
  polyline: string,
  apiKey: string,
  language?: string,
  options?: { markers?: boolean },
): string | null {
  if (!polyline) return null;

  const params = new URLSearchParams({
    maptype: 'roadmap',
    size: '800x800',
    scale: '2',
    key: apiKey,
    ...(language && { language }),
  });

  const showMarkers = options?.markers !== false;
  const points = polylineCodec.decode(polyline);
  if (points.length === 0) return null;

  let url = `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
  if (showMarkers) {
    const start = points[0];
    const end = points[points.length - 1];
    url += `&markers=color:yellow|label:S|${start[0]},${start[1]}`;
    url += `&markers=color:green|label:F|${end[0]},${end[1]}`;
  }

  const MAX_URL = 16384;
  const BUFFER = 200;
  const PATH_PREFIX = '&path=enc:';
  const available = MAX_URL - url.length - PATH_PREFIX.length - BUFFER;
  if (available < 50) return url;
  url += `${PATH_PREFIX}${sampleToFit(points as [number, number][], available)}`;

  return url;
}

/**
 * Build a Google Static Maps URL from multiple polylines (tour = multiple rides).
 */
export function buildGoogleMapsUrlFromPolylines(
  polylines: string[],
  apiKey: string,
  language?: string,
): string | null {
  if (polylines.length === 0) return null;

  const allPoints: number[][] = [];
  const allSegments: number[][][] = [];
  for (const pl of polylines) {
    const points = polylineCodec.decode(pl);
    allPoints.push(...points);
    allSegments.push(points);
  }
  if (allPoints.length === 0) return null;

  const start = allPoints[0];
  const end = allPoints[allPoints.length - 1];

  const params = new URLSearchParams({
    maptype: 'roadmap',
    size: '800x800',
    scale: '2',
    key: apiKey,
    ...(language && { language }),
  });

  let url = `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`
    + `&markers=color:yellow|label:S|${start[0]},${start[1]}`
    + `&markers=color:green|label:F|${end[0]},${end[1]}`;

  const MAX_URL = 16384;
  const BUFFER = 200;
  const PATH_PREFIX = '&path=enc:';
  for (const segment of allSegments) {
    const remaining = MAX_URL - url.length - PATH_PREFIX.length - BUFFER;
    if (remaining < 50) break;
    url += `${PATH_PREFIX}${sampleToFit(segment as [number, number][], remaining)}`;
  }

  return url;
}

export interface ParsedMapImageUrl {
  type: string;
  hash: string;
  slug: string;
  size: string;
  variant?: string;
  lang: string;
}

/**
 * Parse the map image URL path: {type}/{hash}/{filename}.png
 * Filename format: {slug}-{variant?}-{size}-{lang}.png
 * The slug can contain dashes. We parse from the right: lang (last), then
 * check if the next segment is a known size or a variant+size combo.
 */
export function parseMapImagePath(
  rawPath: string,
  knownVariants?: Set<string>,
): ParsedMapImageUrl | null {
  // Strip .png extension
  const withoutExt = rawPath.replace(/\.png$/, '');
  const segments = withoutExt.split('/');
  if (segments.length !== 3) return null;

  const [type, hash, filename] = segments;
  if (!['bike-path', 'route', 'ride', 'tour'].includes(type)) return null;
  if (!hash || !/^[a-f0-9]{12,16}$/.test(hash)) return null;

  // Parse filename from the right: last part is lang, then size, optionally variant
  const parts = filename.split('-');
  if (parts.length < 3) return null; // need at least slug-size-lang

  const lang = parts.pop()!;
  if (!/^[a-z]{2}$/.test(lang)) return null;

  // Try to find size from the right
  // Sizes can be multi-part: "thumb-2x", "thumb-lg"
  let size: string | null = null;
  let variant: string | undefined;

  // Check for 2-part sizes first: "thumb-2x", "thumb-lg"
  if (parts.length >= 3) {
    const twoPartSize = `${parts[parts.length - 2]}-${parts[parts.length - 1]}`;
    if (MAP_SIZE_PRESETS[twoPartSize]) {
      size = twoPartSize;
      parts.pop();
      parts.pop();
    }
  }

  // Check for 1-part sizes: "social", "thumb", "full"
  if (!size && parts.length >= 2) {
    const onePartSize = parts[parts.length - 1];
    if (MAP_SIZE_PRESETS[onePartSize]) {
      size = onePartSize;
      parts.pop();
    }
  }

  if (!size) return null;

  // Remaining parts: could be "slug" or "slug-...-variant"
  // Check if the last remaining part is a known variant
  if (knownVariants && parts.length >= 2) {
    // Variants can be multi-part like "variants-return"
    // Try progressively longer suffixes
    for (let i = parts.length - 1; i >= 1; i--) {
      const candidateVariant = parts.slice(i).join('-');
      if (knownVariants.has(candidateVariant)) {
        variant = candidateVariant;
        parts.splice(i);
        break;
      }
    }
  }

  const slug = parts.join('-');
  if (!slug) return null;

  return { type, hash, slug, size, variant, lang };
}
