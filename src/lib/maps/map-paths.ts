/**
 * Shared map thumbnail helpers — used by both the Astro app (map-thumbnails.ts)
 * and the generation script (map-generation.ts). No virtual module imports here
 * so scripts can use these without Vite.
 */
import polylineCodec from '@mapbox/polyline';
import { haversineKm } from '../geo/proximity';

export interface MapThumbPaths {
  thumbLarge: string;
  thumb: string;
  thumbSmall: string;
  social: string;
  full: string;
}

/**
 * Split a list of points into continuous segments, breaking where consecutive
 * points are more than `maxGapKm` apart. Returns segments with 2+ points,
 * sorted longest first.
 */
function splitAtGaps(points: number[][], maxGapKm: number): number[][][] {
  if (points.length === 0) return [];
  const segments: number[][][] = [[points[0]]];
  for (let i = 1; i < points.length; i++) {
    const [lat1, lon1] = points[i - 1];
    const [lat2, lon2] = points[i];
    const dist = haversineKm(lat1, lon1, lat2, lon2);
    if (dist > maxGapKm) {
      segments.push([]);
    }
    segments[segments.length - 1].push(points[i]);
  }
  return segments.filter(s => s.length >= 2).sort((a, b) => b.length - a.length);
}

/** Adaptively sample points until the encoded polyline fits within maxChars. */
function sampleToFit(points: number[][], maxChars: number): string {
  let interval = 5;
  let encoded: string;
  do {
    const sampled = points.filter((_: number[], i: number) => i % interval === 0);
    if (sampled[sampled.length - 1] !== points[points.length - 1]) sampled.push(points[points.length - 1]);
    encoded = polylineCodec.encode(sampled as [number, number][]);
    if (encoded.length <= maxChars) return encoded;
    interval = Math.ceil(interval * 1.5);
  } while (interval < points.length);
  return encoded!;
}

/** Build a static map URL combining multiple polylines (e.g. all rides in a tour).
 *  Each ride is rendered as a separate path to avoid straight lines between them. */
export function buildStaticMapUrlMulti(polylines: string[], apiKey: string, language?: string): string {
  // Decode each ride's polyline into continuous segments (skip GPS gaps >10km)
  const allSegments: number[][][] = [];
  for (const pl of polylines) {
    allSegments.push(...splitAtGaps(polylineCodec.decode(pl), 10));
  }
  if (allSegments.length === 0) return '';

  const allPoints = allSegments.flat();
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

  // Add each segment as a separate &path= to avoid straight lines between rides/gaps
  for (const segment of allSegments) {
    const remaining = 16384 - url.length - '&path=enc:'.length - 100;
    if (remaining < 50) break;
    url += `&path=enc:${sampleToFit(segment, remaining)}`;
  }

  return url;
}

export function buildStaticMapUrl(polyline: string, apiKey: string, language?: string, options?: { size?: string; markers?: boolean; gapKm?: number }): string {
  const points = polylineCodec.decode(polyline);
  // Split at GPS gaps and render each continuous segment separately
  const segments = splitAtGaps(points, options?.gapKm ?? 10);
  if (segments.length === 0) return '';

  const allPoints = segments.flat();
  const start = allPoints[0];
  const end = allPoints[allPoints.length - 1];
  const showMarkers = options?.markers !== false;

  const params = new URLSearchParams({
    maptype: 'roadmap',
    size: options?.size || '800x800',
    scale: '2',
    key: apiKey,
    ...(language && { language }),
  });

  let url = `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
  if (showMarkers) {
    url += `&markers=color:yellow|label:S|${start[0]},${start[1]}`
      + `&markers=color:green|label:F|${end[0]},${end[1]}`;
  }

  for (const segment of segments) {
    const remaining = 16384 - url.length - '&path=enc:'.length - 100;
    if (remaining < 50) break;
    url += `&path=enc:${sampleToFit(segment, remaining)}`;
  }

  return url;
}

/**
 * Build a static map URL from pre-split segments (no encode/decode round-trip).
 * Each segment becomes its own &path= parameter. Budget is distributed across
 * segments proportionally by point count, so short park paths and long trails
 * both render correctly.
 */
export function buildStaticMapUrlFromSegments(
  segments: [number, number][][],
  apiKey: string,
  language?: string,
  options?: { size?: string; markers?: boolean },
): string {
  // Filter to segments with 2+ points
  const valid = segments.filter(s => s.length >= 2);
  if (valid.length === 0) return '';

  const showMarkers = options?.markers !== false;

  const params = new URLSearchParams({
    maptype: 'roadmap',
    size: options?.size || '800x800',
    scale: '2',
    key: apiKey,
    ...(language && { language }),
  });

  let url = `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
  if (showMarkers) {
    const allPoints = valid.flat();
    const start = allPoints[0];
    const end = allPoints[allPoints.length - 1];
    url += `&markers=color:yellow|label:S|${start[0]},${start[1]}`
      + `&markers=color:green|label:F|${end[0]},${end[1]}`;
  }

  const MAX_URL = 16384;
  const BUFFER = 200;
  const PATH_PREFIX = '&path=enc:';
  const totalPoints = valid.reduce((s, seg) => s + seg.length, 0);

  // Sort longest first so the most important segments get priority
  const sorted = [...valid].sort((a, b) => b.length - a.length);

  for (const segment of sorted) {
    const available = MAX_URL - url.length - PATH_PREFIX.length - BUFFER;
    if (available < 50) break;

    // Give this segment a budget proportional to its share of total points,
    // but at least enough for a minimal encoding
    const share = segment.length / totalPoints;
    const budget = Math.max(50, Math.min(available, Math.ceil(share * (MAX_URL - url.length) * 0.8)));
    const capped = Math.min(budget, available);

    url += `${PATH_PREFIX}${sampleToFit(segment as number[][], capped)}`;
  }

  return url;
}

