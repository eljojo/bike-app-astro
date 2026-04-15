/**
 * Grouping rule for turning a flat list of OSM way features into
 * cyclist-meaningful logical segments. Pure function, no I/O.
 *
 * The rule: group strictly by the OSM `name` tag. Same name = same
 * segment, regardless of surface or physical connectivity. Unnamed ways
 * collapse into a single `{name: undefined}` segment. For each segment,
 * the segment-wide `surface_mix` is computed by summing km per surface
 * value across every way in the segment.
 *
 * `surface_mix` has the same structural shape as the entry-level
 * `surface_mix` field on `BikePathPage` (see
 * `src/lib/bike-paths/bike-path-entries.server.ts`) but uses
 * **one-decimal-place** km rounding, while the entry-level field in
 * `scripts/pipeline/lib/osm-tags.ts::mergeWayTags` rounds to integer
 * km. The divergence is deliberate: heterogeneous long-distance trails
 * may contain short surface transitions (e.g. a 0.1 km gravel bridge on
 * a mostly-asphalt section) that are meaningful to a clicking cyclist
 * but would vanish under integer rounding. A segment popup rendering
 * "9 km asphalt · 0.1 km gravel" needs the 0.1 to stay visible.
 *
 * This is the single source of truth for the grouping rule. The tile
 * builder (`scripts/generate-path-tiles.ts::mergeFeatures`) is the only
 * caller today; a future `bikepaths.yml` writer phase will be the
 * second. Keep the rule here — do not reimplement it inline in a caller.
 */

import { haversineKm } from '../geo/proximity';

/**
 * Per-way input to the grouper. `lines` is an array of polylines (each
 * polyline is an array of positions), mirroring the shape of a GeoJSON
 * LineString or MultiLineString after truncation. Positions are typed
 * as `readonly number[]` so that a GeoJSON `Position[][]` (which may
 * carry elevation as a third coordinate) is assignable without a cast;
 * the grouper only reads `coord[0]` (lng) and `coord[1]` (lat).
 */
export interface WayInput {
  name?: string;
  surface?: string;
  lines: ReadonlyArray<ReadonlyArray<readonly number[]>>;
}

/**
 * Output of the grouper. One `LogicalSegment` per distinct `name` in
 * the input (plus at most one `{name: undefined}` segment for all
 * unnamed ways). `surface_mix` is segment-wide, rounded to one decimal
 * place, sorted descending by km. `ways` is a pass-through of the
 * input objects for each way that belongs to this segment, so the
 * caller can distribute them across surface-category features.
 *
 * Generic over `W extends WayInput` so the caller can pass a narrower
 * way type (e.g. with concrete `Position[][]` lines) and read it back
 * out on the `ways` array without a cast.
 */
export interface LogicalSegment<W extends WayInput = WayInput> {
  name?: string;
  surface_mix: Array<{ value: string; km: number }>;
  ways: W[];
}

export function groupWaysIntoSegments<W extends WayInput>(ways: W[]): LogicalSegment<W>[] {
  // Map<nameKey, W[]>. `undefined` is a valid key via a special value.
  const UNNAMED = Symbol('unnamed') as unknown as undefined;
  const buckets = new Map<string | typeof UNNAMED, W[]>();
  for (const w of ways) {
    const key = (w.name && w.name.length > 0) ? w.name : UNNAMED;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(w);
  }

  const segments: LogicalSegment<W>[] = [];
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
function linesLengthKm(lines: ReadonlyArray<ReadonlyArray<readonly number[]>>): number {
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
