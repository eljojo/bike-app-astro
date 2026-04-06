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
import fs from 'node:fs';
import path from 'node:path';
import type {
  Feature,
  FeatureCollection,
  LineString,
  MultiLineString,
  Position,
} from 'geojson';

import type { TileFeatureMeta, TileManifestEntry } from '../src/lib/maps/tile-types';
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

export const DEFAULT_MAX_COORDS = 15_000;
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

/**
 * Merge all features for a single geoId into one geometry.
 *
 * - Multiple LineStrings become a MultiLineString
 * - A single LineString stays as-is
 * - MultiLineStrings are flattened and merged
 * - Coordinates are truncated to 5dp
 */
function mergeFeatures(
  geoId: string,
  fc: FeatureCollection,
  metadata?: Map<string, GeoMetaEntry>,
): Feature<LineString | MultiLineString> | null {
  const allLineArrays: Position[][] = [];

  for (const feature of fc.features) {
    const geom = feature.geometry;
    if (!geom) continue;

    if (geom.type === 'LineString') {
      const truncated = truncateCoords(geom.coordinates);
      if (truncated.length > 0) allLineArrays.push(truncated);
    } else if (geom.type === 'MultiLineString') {
      for (const line of geom.coordinates) {
        const truncated = truncateCoords(line);
        if (truncated.length > 0) allLineArrays.push(truncated);
      }
    }
  }

  if (allLineArrays.length === 0) return null;

  // Build properties
  const meta = metadata?.get(geoId);
  const properties: TileFeatureMeta = {
    _geoId: geoId,
    _fid: geoId,
    slug: meta?.slug ?? '',
    name: meta?.name ?? '',
    memberOf: meta?.memberOf ?? '',
    surface: meta?.surface ?? '',
    hasPage: meta?.hasPage ?? false,
    path_type: meta?.path_type ?? '',
    dashed: meta?.path_type === 'trail' || meta?.path_type === 'mtb-trail',
    length_km: meta?.length_km ?? 0,
  };

  // Single LineString stays as LineString
  if (allLineArrays.length === 1) {
    return {
      type: 'Feature',
      properties,
      geometry: { type: 'LineString', coordinates: allLineArrays[0] },
    };
  }

  return {
    type: 'Feature',
    properties,
    geometry: { type: 'MultiLineString', coordinates: allLineArrays },
  };
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

  // Step 1: Merge features per geoId
  const merged: Feature[] = [];
  for (const [geoId, fc] of input) {
    const feature = mergeFeatures(geoId, fc, metadata);
    if (feature) merged.push(feature);
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

  const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.geojson'));

  // Read all geojson files from cache
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
  for (const [geoId, fc] of input) {
    fs.writeFileSync(path.join(geoOutDir, `${geoId}.geojson`), JSON.stringify(fc));
  }
  console.log(`[path-geo] Copied ${input.size} geometry files to ${geoOutDir}/`);

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

  console.log(`[path-tiles] Generated ${tiles.size} tiles (${totalFeatures} features) + manifest`);
}
