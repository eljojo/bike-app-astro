/**
 * Generate spatial tiles from individual path GeoJSON files.
 *
 * Merges all features per geoId into a single geometry, truncates
 * coordinates to 5 decimal places, injects metadata, and splits
 * tiles adaptively via quadtree so no tile exceeds a coordinate budget.
 *
 * Pure logic: buildTiles() — tested directly
 * CLI entry point: runs when executed as a script
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  Feature,
  FeatureCollection,
  LineString,
  MultiLineString,
  Position,
} from 'geojson';

import type { Segment, TileFeatureMeta, TileManifestEntry } from '../src/lib/maps/tile-types';
import { groupWaysIntoSegments, type WayInput } from '../src/lib/bike-paths/segments';
export type { TileManifestEntry, TileFeatureMeta };

/** Metadata entry keyed by geoId, passed into buildTiles. */
export interface GeoMetaEntry {
  slug: string;
  name: string;
  memberOf: string;
  surface: string;
  hasPage: boolean;
  path_type: string;
  length_km: number;
}

export interface TileData {
  features: Feature[];
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export const DEFAULT_MAX_COORDS = 300_000;
const MAX_DEPTH = 12;

// ── Helpers ──────────────────────────────────────────────────────

/** Round a single number to 5 decimal places. */
function roundCoord(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

/** Truncate all coordinates in a position array to 5dp. */
function truncateCoords(coords: Position[]): Position[] {
  return coords.map(([lng, lat, ...rest]) => {
    const out: Position = [roundCoord(lng), roundCoord(lat)];
    if (rest.length > 0) out.push(...rest.map(roundCoord));
    return out;
  });
}

/** Extract all coordinate positions from a feature's geometry. */
function extractCoordinates(feature: Feature): Position[] {
  const geom = feature.geometry;
  if (!geom) return [];

  switch (geom.type) {
    case 'LineString':
      return geom.coordinates;
    case 'MultiLineString':
      return geom.coordinates.flat();
    default:
      return [];
  }
}

/** Count only coordinates that fall within a bounding box. */
function countCoordsInBox(features: Feature[], box: SplitBox): number {
  let total = 0;
  for (const f of features) {
    for (const [lng, lat] of extractCoordinates(f)) {
      if (lng >= box.minLng && lng <= box.maxLng && lat >= box.minLat && lat <= box.maxLat) {
        total++;
      }
    }
  }
  return total;
}

// ── Surface classification ──────────────────────────────────────

/** OSM surface values considered "paved" — solid line on map. */
const ROAD_SURFACES = new Set([
  'asphalt', 'concrete', 'paving_stones', 'paved',
  'sett', 'cobblestone', 'concrete:plates', 'concrete:lanes',
  'bricks', 'metal', 'wood',
]);

/** OSM surface values considered "gravel" — long dash on map. */
const GRAVEL_SURFACES = new Set([
  'fine_gravel', 'gravel', 'compacted', 'pebblestone',
]);

export type SurfaceCategory = 'road' | 'gravel' | 'mtb';

export function classifySurface(surface: string | undefined): SurfaceCategory {
  if (!surface) return 'mtb'; // unknown = assume rough
  const s = surface.toLowerCase();
  if (ROAD_SURFACES.has(s)) return 'road';
  if (GRAVEL_SURFACES.has(s)) return 'gravel';
  return 'mtb';
}

/** Collect and truncate line coordinates from a geometry. */
function collectLines(geom: Feature['geometry']): Position[][] {
  if (!geom) return [];
  const lines: Position[][] = [];
  if (geom.type === 'LineString') {
    const truncated = truncateCoords((geom as LineString).coordinates);
    if (truncated.length > 0) lines.push(truncated);
  } else if (geom.type === 'MultiLineString') {
    for (const line of (geom as MultiLineString).coordinates) {
      const truncated = truncateCoords(line);
      if (truncated.length > 0) lines.push(truncated);
    }
  }
  return lines;
}

function buildProps(geoId: string, meta: GeoMetaEntry | undefined, surfaceCategory?: SurfaceCategory): TileFeatureMeta {
  return {
    _geoId: geoId,
    _fid: geoId,
    slug: meta?.slug ?? '',
    name: meta?.name ?? '',
    memberOf: meta?.memberOf ?? '',
    surface: meta?.surface ?? '',
    surface_category: surfaceCategory ?? classifySurface(meta?.surface),
    hasPage: meta?.hasPage ?? false,
    path_type: meta?.path_type ?? '',
    length_km: meta?.length_km ?? 0,
  };
}

function buildFeature(
  lineArrays: Position[][],
  props: TileFeatureMeta,
): Feature<LineString | MultiLineString> {
  if (lineArrays.length === 1) {
    return { type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: lineArrays[0] } };
  }
  return { type: 'Feature', properties: props, geometry: { type: 'MultiLineString', coordinates: lineArrays } };
}

// ── Feature merging ─────────────────────────────────────────────

/**
 * Merge all features for a single geoId into up to three tile features
 * (one per surface_category), each with a `_segments` array that groups
 * the underlying OSM ways by name.
 *
 * Splits ways by surface category (road/gravel/mtb) before merging.
 * Uses per-way surface tags when available, falling back to metadata surface.
 * Produces up to 3 features per path for mixed-surface paths.
 *
 * CRITICAL INVARIANT — contiguous sub-line ordering:
 *
 *   The MultiLineString geometry of each emitted feature MUST have all
 *   sub-lines of `_segments[0]` before any sub-line of `_segments[1]`,
 *   and so on. The `lineCount` on each segment is exactly the length of
 *   its contiguous run. The click handler in
 *   `src/lib/maps/layers/tile-path-interactions.ts::resolveSegmentFromClick`
 *   walks this array with a running offset to map a sub-line index back
 *   to the owning segment. If you change how lines are appended to
 *   `categoryBuckets[cat].lines`, update both sides together — the
 *   click-time lookup will silently resolve to the wrong segment if the
 *   ordering drifts.
 *
 *   See `_ctx/bike-path-tiles.md` "Segment resolution" for the full
 *   contract and `src/lib/bike-paths/segments.ts::groupWaysIntoSegments`
 *   for the grouping rule itself.
 */
function mergeFeatures(
  geoId: string,
  fc: FeatureCollection,
  metadata?: Map<string, GeoMetaEntry>,
): Feature<LineString | MultiLineString>[] {
  const meta = metadata?.get(geoId);

  // ── Phase 1: collect per-way inputs with name and surface ────────
  const wayInputs: WayInput[] = [];
  for (const feature of fc.features) {
    const truncatedLines = collectLines(feature.geometry);
    if (truncatedLines.length === 0) continue;
    const props = feature.properties ?? {};
    const name = typeof props.name === 'string' && props.name.length > 0 ? props.name : undefined;
    const surface = typeof props.surface === 'string' && props.surface.length > 0 ? props.surface : undefined;
    wayInputs.push({
      name,
      surface,
      lines: truncatedLines as Array<Array<[number, number]>>,
    });
  }
  if (wayInputs.length === 0) return [];

  // ── Phase 2: group into logical segments (pure function) ─────────
  const logicalSegments = groupWaysIntoSegments(wayInputs);

  // ── Phase 3: distribute each segment's ways across surface categories ──
  // categoryBuckets[cat] accumulates lines in segment order so that
  // _segments[i]'s lineCount partitions the resulting MultiLineString
  // contiguously.
  type CategoryBucket = { lines: Position[][]; segments: Segment[] };
  const categoryBuckets: Record<SurfaceCategory, CategoryBucket> = {
    road: { lines: [], segments: [] },
    gravel: { lines: [], segments: [] },
    mtb: { lines: [], segments: [] },
  };

  for (const ls of logicalSegments) {
    // Split this logical segment's ways across the three surface categories.
    const linesByCategory: Record<SurfaceCategory, Position[][]> = {
      road: [],
      gravel: [],
      mtb: [],
    };
    for (const way of ls.ways) {
      // Per-way surface tag wins; fall back to the entry-level metadata
      // surface so ways with no explicit surface still land in the right
      // category (preserves prior behaviour).
      const cat = classifySurface(way.surface ?? meta?.surface);
      for (const waysLine of way.lines) {
        linesByCategory[cat].push(waysLine);
      }
    }
    // Append to each category bucket in segment order; every non-empty
    // category gets a Segment record with the *segment-wide*
    // surface_mix (identical across duplicates) and a per-feature
    // lineCount (the number of sub-lines of this segment that
    // ended up in this category).
    for (const cat of ['road', 'gravel', 'mtb'] as const) {
      const catLines = linesByCategory[cat];
      if (catLines.length === 0) continue;
      categoryBuckets[cat].lines.push(...catLines);
      categoryBuckets[cat].segments.push({
        name: ls.name,
        surface_mix: ls.surface_mix,
        lineCount: catLines.length,
      });
    }
  }

  // ── Phase 4: emit one feature per active surface category ───────
  const activeCategories = (['road', 'gravel', 'mtb'] as const)
    .filter(c => categoryBuckets[c].lines.length > 0);
  if (activeCategories.length === 0) return [];
  const needsSplit = activeCategories.length > 1;

  const results: Feature<LineString | MultiLineString>[] = [];
  for (const cat of activeCategories) {
    const bucket = categoryBuckets[cat];
    const props = buildProps(geoId, meta, cat);
    if (needsSplit) props._fid = `${geoId}:${cat}`;
    // Attach segments as a feature property. `_segments` is intentionally
    // allowed on TileFeatureMeta as optional.
    props._segments = bucket.segments;
    results.push(buildFeature(bucket.lines, props));
  }
  return results;
}

// ── Adaptive quadtree splitting ──────────────────────────────────

interface SplitBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

/** Check if a feature has any coordinates inside a bounding box. */
function featureIntersectsBox(feature: Feature, box: SplitBox): boolean {
  const coords = extractCoordinates(feature);
  for (const [lng, lat] of coords) {
    if (lng >= box.minLng && lng <= box.maxLng && lat >= box.minLat && lat <= box.maxLat) {
      return true;
    }
  }
  return false;
}

/**
 * Recursively split a set of features into tiles using quadtree subdivision.
 *
 * If the total coordinate count is within budget, emit a single tile.
 * Otherwise, split the bounding box into 4 quadrants and recurse.
 */
function splitAdaptive(
  prefix: string,
  features: Feature[],
  box: SplitBox,
  maxCoords: number,
  depth: number,
  result: Map<string, TileData>,
): void {
  if (features.length === 0) return;

  // Count only coordinates within this tile's bounds — not the feature's total.
  // A long path spanning the city is one feature; without this, its full coord
  // count would inflate every quadrant it touches, causing infinite splitting.
  const coordCount = countCoordsInBox(features, box);

  // Emit tile if within budget or at max depth
  if (coordCount <= maxCoords || depth >= MAX_DEPTH) {
    // Compute actual bounds from features
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const f of features) {
      for (const [lng, lat] of extractCoordinates(f)) {
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
      }
    }

    result.set(prefix, {
      features,
      minLng,
      minLat,
      maxLng,
      maxLat,
    });
    return;
  }

  // Split into 4 quadrants
  const midLng = (box.minLng + box.maxLng) / 2;
  const midLat = (box.minLat + box.maxLat) / 2;

  const quadrants: [string, SplitBox][] = [
    [`${prefix}_0`, { minLng: box.minLng, minLat: midLat, maxLng: midLng, maxLat: box.maxLat }],
    [`${prefix}_1`, { minLng: midLng, minLat: midLat, maxLng: box.maxLng, maxLat: box.maxLat }],
    [`${prefix}_2`, { minLng: box.minLng, minLat: box.minLat, maxLng: midLng, maxLat: midLat }],
    [`${prefix}_3`, { minLng: midLng, minLat: box.minLat, maxLng: box.maxLng, maxLat: midLat }],
  ];

  for (const [qPrefix, qBox] of quadrants) {
    const qFeatures = features.filter(f => featureIntersectsBox(f, qBox));
    splitAdaptive(qPrefix, qFeatures, qBox, maxCoords, depth + 1, result);
  }
}

// ── Main ─────────────────────────────────────────────────────────

export interface BuildTilesOptions {
  maxCoords?: number;
}

/**
 * Build spatial tiles from a map of geoId -> FeatureCollection.
 *
 * 1. Merges all features per geoId into one MultiLineString (or keeps single LineString)
 * 2. Truncates coordinates to 5 decimal places
 * 3. Injects metadata from an optional metadata map
 * 4. Splits tiles adaptively via quadtree
 */
export function buildTiles(
  input: Map<string, FeatureCollection>,
  metadata?: Map<string, GeoMetaEntry>,
  options?: BuildTilesOptions,
): {
  tiles: Map<string, TileData>;
  manifest: TileManifestEntry[];
} {
  const maxCoords = options?.maxCoords ?? DEFAULT_MAX_COORDS;

  // Step 1: Merge features per geoId (skip stale entries with no metadata)
  const merged: Feature[] = [];
  for (const [geoId, fc] of input) {
    if (metadata && !metadata.has(geoId)) continue;
    merged.push(...mergeFeatures(geoId, fc, metadata));
  }

  if (merged.length === 0) {
    return { tiles: new Map(), manifest: [] };
  }

  // Step 2: Compute global bounding box
  let globalMinLng = Infinity, globalMinLat = Infinity;
  let globalMaxLng = -Infinity, globalMaxLat = -Infinity;
  for (const f of merged) {
    for (const [lng, lat] of extractCoordinates(f)) {
      if (lng < globalMinLng) globalMinLng = lng;
      if (lat < globalMinLat) globalMinLat = lat;
      if (lng > globalMaxLng) globalMaxLng = lng;
      if (lat > globalMaxLat) globalMaxLat = lat;
    }
  }

  // Step 3: Adaptive quadtree split
  const tiles = new Map<string, TileData>();
  splitAdaptive(
    '0',
    merged,
    { minLng: globalMinLng, minLat: globalMinLat, maxLng: globalMaxLng, maxLat: globalMaxLat },
    maxCoords,
    0,
    tiles,
  );

  // Step 4: Build manifest, sorted by numeric id for deterministic output
  const manifest: TileManifestEntry[] = [...tiles.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([id, tile]) => ({
      id,
      bounds: [tile.minLng, tile.minLat, tile.maxLng, tile.maxLat],
      featureCount: tile.features.length,
      file: `tile-${id}.geojson`,
    }));

  return { tiles, manifest };
}

// ── Canonical-target invariant ───────────────────────────────────

/** One OSM way that resolves to more than one page slug. */
export interface CanonicalTargetConflict {
  wayId: number;
  slugs: string[];
}

/**
 * Detect violations of the canonical-target invariant: "one physical
 * clickable path segment -> one canonical page target". A wayId may live
 * in multiple cache files (a page can aggregate geometry from several
 * relations), but they must all resolve to the SAME slug. When two
 * distinct slugs claim the same OSM way the user's click is ambiguous
 * and the map opens whichever popup MapLibre happens to return first —
 * that is the bug class behind Parc de la Gatineau and Scott Street.
 *
 * Stale cache files with no metadata entry are skipped: they are already
 * dropped by buildTiles, so they shouldn't influence the check.
 */
export function findCanonicalTargetConflicts(
  input: Map<string, FeatureCollection>,
  metadata: Map<string, GeoMetaEntry>,
): CanonicalTargetConflict[] {
  const wayToSlugs = new Map<number, Set<string>>();
  for (const [geoId, fc] of input) {
    const meta = metadata.get(geoId);
    if (!meta) continue;
    for (const feature of fc.features) {
      const wayId = (feature.properties as { wayId?: unknown } | null)?.wayId;
      if (typeof wayId !== 'number') continue;
      let slugs = wayToSlugs.get(wayId);
      if (!slugs) {
        slugs = new Set();
        wayToSlugs.set(wayId, slugs);
      }
      slugs.add(meta.slug);
    }
  }

  const conflicts: CanonicalTargetConflict[] = [];
  for (const [wayId, slugs] of wayToSlugs) {
    if (slugs.size > 1) {
      conflicts.push({ wayId, slugs: [...slugs].sort() });
    }
  }
  return conflicts.sort((a, b) => a.wayId - b.wayId);
}

// ── Slug index ───────────────────────────────────────────────────

export interface SlugIndexEntry {
  tiles: string[];
  hash: string;
}

/**
 * Build a slug -> { tiles, hash } index from the tile output.
 * The hash is computed from the slug's geometry coordinates (SHA-256, 12 hex chars).
 * Deduplicates features by _fid across tiles (cross-boundary duplicates).
 */
export function buildSlugIndex(
  tiles: Map<string, TileData>,
): Record<string, SlugIndexEntry> {
  const slugTiles = new Map<string, Set<string>>();
  const slugCoords = new Map<string, number[]>();
  const seenFids = new Set<string>();

  for (const [tileId, tile] of tiles) {
    for (const feature of tile.features) {
      const slug = (feature.properties as TileFeatureMeta)?.slug;
      if (!slug) continue;

      if (!slugTiles.has(slug)) slugTiles.set(slug, new Set());
      slugTiles.get(slug)!.add(tileId);

      const fid = (feature.properties as TileFeatureMeta)?._fid ?? '';
      const dedupKey = `${slug}:${fid}`;
      if (!seenFids.has(dedupKey)) {
        seenFids.add(dedupKey);
        if (!slugCoords.has(slug)) slugCoords.set(slug, []);
        for (const coord of extractCoordinates(feature)) {
          slugCoords.get(slug)!.push(...coord);
        }
      }
    }
  }

  const index: Record<string, SlugIndexEntry> = {};
  for (const [slug, tileIds] of slugTiles) {
    const coords = slugCoords.get(slug) ?? [];
    const hash = crypto
      .createHash('sha256')
      .update(Float64Array.from(coords))
      .digest('hex')
      .slice(0, 12);
    index[slug] = {
      tiles: [...tileIds].sort(),
      hash,
    };
  }

  return index;
}

// --- CLI entry point ---
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);

if (isMainModule) {
  if (process.env.ENABLE_BIKE_PATHS === 'false') {
    console.log('[path-tiles] ENABLE_BIKE_PATHS=false — skipping');
    process.exit(0);
  }

  const CITY = process.env.CITY || 'ottawa';
  const cacheDir = path.resolve('.cache', 'bikepath-geometry', CITY);

  const tilesDir = path.resolve('public', 'bike-paths', 'geo', 'tiles');
  const metaPath = path.resolve('public', 'bike-paths', 'geo', 'geo-metadata.json');

  if (!fs.existsSync(cacheDir)) {
    console.log(`[path-tiles] No cache directory at ${cacheDir} — skipping`);
    process.exit(0);
  }

  // Read geo files from manifest (authoritative list from cache-path-geometry).
  // Falls back to globbing the directory if no manifest exists (first run / old cache).
  const manifestPath = path.join(cacheDir, 'manifest.json');
  let files: string[];
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    files = (manifest.files as string[]).filter(f => fs.existsSync(path.join(cacheDir, f)));
    console.log(`[path-tiles] Reading ${files.length} files from manifest (${manifest.files.length} listed)`);
  } else {
    files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.geojson'));
    console.log(`[path-tiles] No manifest found — falling back to directory glob (${files.length} files)`);
  }

  // Read geojson files
  const input = new Map<string, FeatureCollection>();
  for (const file of files) {
    const geoId = file.replace('.geojson', '');
    const content = fs.readFileSync(path.join(cacheDir, file), 'utf-8');
    input.set(geoId, JSON.parse(content) as FeatureCollection);
  }

  // Demo city: read from e2e/fixtures/overpass/ (overwrite cache — cache may have
  // empty results from failed Overpass fetches for fake relation IDs)
  if (CITY === 'demo') {
    const fixtureDir = path.resolve('e2e', 'fixtures', 'overpass');
    if (fs.existsSync(fixtureDir)) {
      const fixtures = fs.readdirSync(fixtureDir).filter(f => f.endsWith('.geojson'));
      for (const file of fixtures) {
        const geoId = file.replace('.geojson', '');
        const content = fs.readFileSync(path.join(fixtureDir, file), 'utf-8');
        input.set(geoId, JSON.parse(content) as FeatureCollection);
      }
    }
  }

  if (input.size === 0) {
    console.log('[path-tiles] No geojson files found — skipping');
    process.exit(0);
  }

  // Read optional metadata
  let metadata: Map<string, GeoMetaEntry> | undefined;
  if (fs.existsSync(metaPath)) {
    const raw = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as Record<string, GeoMetaEntry>;
    metadata = new Map(Object.entries(raw));
    console.log(`[path-tiles] Loaded metadata for ${metadata.size} geoIds`);
  }

  // Copy raw geojson files to public/ before buildTiles (which may mutate input).
  // Needed by getPathLengthKm() in bike-path-entries.server.ts during astro build.
  const geoOutDir = path.resolve('public', 'bike-paths', 'geo');
  fs.mkdirSync(geoOutDir, { recursive: true });
  for (const f of fs.readdirSync(geoOutDir)) {
    if (f.endsWith('.geojson')) fs.unlinkSync(path.join(geoOutDir, f));
  }
  let geoCopied = 0;
  for (const [geoId, fc] of input) {
    if (metadata && !metadata.has(geoId)) continue;
    fs.writeFileSync(path.join(geoOutDir, `${geoId}.geojson`), JSON.stringify(fc));
    geoCopied++;
  }
  console.log(`[path-geo] Copied ${geoCopied} geometry files to ${geoOutDir}/ (${input.size - geoCopied} stale skipped)`);

  // Canonical-target invariant: one physical clickable segment -> one page.
  // If any OSM way ends up under two different slugs the map click target is
  // ambiguous (Parc de la Gatineau / Scott Street bug class). Warn loudly so
  // the regression is visible in every rebuild.
  if (metadata) {
    const conflicts = findCanonicalTargetConflicts(input, metadata);
    if (conflicts.length > 0) {
      const sample = conflicts.slice(0, 5)
        .map(c => `    way ${c.wayId}: ${c.slugs.join(' vs ')}`).join('\n');
      console.warn(`[path-tiles] ⚠ ${conflicts.length} OSM way(s) claimed by multiple slugs — map popups will be ambiguous:\n${sample}${conflicts.length > 5 ? `\n    ... and ${conflicts.length - 5} more` : ''}`);
    }
  }

  const { tiles, manifest } = buildTiles(input, metadata);

  // Clean previous tiles
  if (fs.existsSync(tilesDir)) {
    fs.rmSync(tilesDir, { recursive: true });
  }
  fs.mkdirSync(tilesDir, { recursive: true });

  // Write tile files
  let totalFeatures = 0;
  for (const [id, tile] of tiles) {
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: tile.features,
    };
    fs.writeFileSync(path.join(tilesDir, `tile-${id}.geojson`), JSON.stringify(fc));
    totalFeatures += tile.features.length;
  }

  // Write manifest
  fs.writeFileSync(path.join(tilesDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Write slug index (slug -> tile IDs + geometry hash)
  const slugIndex = buildSlugIndex(tiles);
  fs.writeFileSync(path.join(tilesDir, 'slug-index.json'), JSON.stringify(slugIndex));
  console.log(`[path-tiles] Generated slug index for ${Object.keys(slugIndex).length} slugs`);

  console.log(`[path-tiles] Generated ${tiles.size} tiles (${totalFeatures} features) + manifest`);
}
