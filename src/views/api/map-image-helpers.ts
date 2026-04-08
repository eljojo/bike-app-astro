import polylineCodec from '@mapbox/polyline';
import { mergeAdjacentSegments } from '../../lib/geo/merge-segments';
import type { FeatureCollection, Feature, LineString, MultiLineString } from 'geojson';

export interface SlugIndex {
  [slug: string]: { tiles: string[]; hash: string };
}

export interface SizePreset {
  size: string;
  scale: number;
}

export const MAP_SIZE_PRESETS: Record<string, SizePreset> = {
  social: { size: '600x315', scale: 2 },
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
    size: preset.size,
    scale: String(preset.scale),
    key: apiKey,
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
