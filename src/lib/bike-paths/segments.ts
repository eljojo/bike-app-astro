/**
 * Grouping rule for turning a flat list of OSM way features into
 * cyclist-meaningful logical segments. Pure function, no I/O.
 *
 * The rule: group strictly by the OSM `name` tag. Same name = same
 * segment, regardless of surface or physical connectivity. Unnamed ways
 * collapse into a single `{name: undefined}` segment. For each segment,
 * the segment-wide `surface_mix` is computed by summing km per surface
 * value across every way in the segment — mirroring the entry-level
 * `surface_mix` field on `BikePathPage`.
 *
 * This is the single source of truth for the grouping rule. The tile
 * builder (`scripts/generate-path-tiles.ts::mergeFeatures`) is the only
 * caller today; a future `bikepaths.yml` writer phase will be the
 * second. Keep the rule here — do not reimplement it inline in a caller.
 */

import { haversineKm } from '../geo/proximity';

/**
 * Per-way input to the grouper. `lines` is an array of polylines (each
 * polyline is an array of [lng, lat] tuples), mirroring the shape of a
 * GeoJSON LineString or MultiLineString after truncation.
 */
export interface WayInput {
  name?: string;
  surface?: string;
  lines: Array<Array<[number, number]>>;
}

/**
 * Output of the grouper. One `LogicalSegment` per distinct `name` in
 * the input (plus at most one `{name: undefined}` segment for all
 * unnamed ways). `surface_mix` is segment-wide, rounded to one decimal
 * place, sorted descending by km. `ways` is a pass-through of the
 * input objects for each way that belongs to this segment, so the
 * caller can distribute them across surface-category features.
 */
export interface LogicalSegment {
  name?: string;
  surface_mix: Array<{ value: string; km: number }>;
  ways: WayInput[];
}

export function groupWaysIntoSegments(ways: WayInput[]): LogicalSegment[] {
  // Map<nameKey, WayInput[]>. `undefined` is a valid key via a special value.
  const UNNAMED = Symbol('unnamed') as unknown as undefined;
  const buckets = new Map<string | typeof UNNAMED, WayInput[]>();
  for (const w of ways) {
    const key = (w.name && w.name.length > 0) ? w.name : UNNAMED;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(w);
  }

  const segments: LogicalSegment[] = [];
  for (const [key, bucketWays] of buckets) {
    const name = key === UNNAMED ? undefined : (key as string);
    const kmBySurface = new Map<string, number>();
    for (const w of bucketWays) {
      const km = linesLengthKm(w.lines);
      const surfaceKey = (w.surface && w.surface.length > 0) ? w.surface : 'unknown';
      kmBySurface.set(surfaceKey, (kmBySurface.get(surfaceKey) ?? 0) + km);
    }
    const surface_mix = [...kmBySurface.entries()]
      .map(([value, km]) => ({ value, km: Math.round(km * 10) / 10 }))
      .sort((a, b) => b.km - a.km);
    segments.push({ name, surface_mix, ways: bucketWays });
  }
  return segments;
}

/** Total length in km of a list of polylines using the project's haversine helper. */
function linesLengthKm(lines: Array<Array<[number, number]>>): number {
  let total = 0;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const [lng1, lat1] = line[i - 1];
      const [lng2, lat2] = line[i];
      total += haversineKm(lat1, lng1, lat2, lng2);
    }
  }
  return total;
}
