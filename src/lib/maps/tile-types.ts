export interface TileManifestEntry {
  id: string;
  bounds: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
  featureCount: number;
  file: string;
}

/**
 * One cyclist-meaningful sub-unit of a bike path, grouped from one or more
 * OSM ways that share a `name` tag. Stored on tile feature properties as
 * `_segments`. Many-to-one with the feature's MultiLineString sub-lines:
 * each segment corresponds to `lineCount` contiguous sub-lines in the
 * geometry.
 *
 * See `scripts/generate-path-tiles.ts::mergeFeatures` for how segments are
 * built and `src/lib/bike-paths/segments.ts::groupWaysIntoSegments` for
 * the grouping rule. See `_ctx/bike-path-tiles.md` for the full invariant.
 */
export interface Segment {
  /**
   * Segment display name, from OSM `name` tag. Undefined when the
   * underlying ways have no name; the popup falls back to the parent
   * entry's name when a click resolves to an unnamed segment.
   */
  name?: string;

  /**
   * Segment-wide surface distribution in kilometres per surface value.
   * Same shape as the optional entry-level `surface_mix` field on
   * `BikePathPage` (see `src/lib/bike-paths/bike-path-entries.server.ts`)
   * so the popup can reuse existing display logic. Unlike the entry-level
   * field, which is only emitted when ≥2 distinct surfaces exist on a
   * path, this is **always present** on a `Segment` — a uniform-surface
   * segment is represented as a single-element array, e.g.
   * `[{ value: 'asphalt', km: 1.2 }]`. For a segment whose underlying
   * ways span multiple surface categories (e.g. a mostly-asphalt path
   * with a short gravel bridge), this array captures the full
   * distribution and is *identical* across every copy of this segment in
   * every surface-category tile feature the segment appears in. Sorted
   * descending by km.
   */
  surface_mix: Array<{ value: string; km: number }>;

  /**
   * Count of consecutive sub-lines in the owning tile feature's
   * MultiLineString that belong to this segment.
   *
   * CRITICAL INVARIANT: `mergeFeatures` must emit the MultiLineString
   * with same-segment sub-lines contiguous — all of `_segments[0]`'s
   * sub-lines come before any of `_segments[1]`'s, and so on. The click
   * handler in `src/lib/maps/layers/tile-path-interactions.ts` walks
   * this array with a running offset to find which segment contains the
   * clicked sub-line.
   * If you change the emission order in `mergeFeatures`, the click
   * handler will silently resolve clicks to the wrong segment. Keep
   * both sides in lockstep and update the tests when this changes.
   */
  lineCount: number;
}

/** Metadata baked into each tile feature's properties. */
export interface TileFeatureMeta {
  _geoId: string;
  _fid: string;
  slug: string;
  name: string;
  memberOf: string;
  surface: string;
  /** Surface category for rendering: road (solid), gravel (long dash), mtb (short dash). */
  surface_category: 'road' | 'gravel' | 'mtb';
  hasPage: boolean;
  path_type: string;
  length_km: number;
  /**
   * Logical sub-units of this tile feature, grouped by OSM name tag.
   * One entry per distinct name; unnamed sub-lines collapse to a single
   * `{name: undefined}` entry per feature. Absent on tiles built before
   * per-way name preservation was added to `cache-path-geometry.ts` —
   * consumers should treat the whole feature as unresolvable to a
   * segment and fall back to entry-level rendering.
   */
  _segments?: Segment[];
}
