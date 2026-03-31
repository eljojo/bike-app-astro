/**
 * Generate spatial tiles from individual path GeoJSON files.
 *
 * Groups features into 1-degree tiles (floor of lat/lng) so the client
 * can load only the tiles visible in the viewport instead of all 601 files.
 *
 * Pure logic: buildTiles() — tested directly
 * CLI entry point: runs when executed as a script
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Feature, FeatureCollection, Position } from 'geojson';

export interface TileData {
  features: Feature[];
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface TileManifestEntry {
  id: string;
  bounds: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
  featureCount: number;
  file: string;
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
      // Skip non-line geometry gracefully
      return [];
  }
}

/** Compute which 1-degree tile IDs a set of coordinates touches. */
function tileIdsForCoordinates(coords: Position[]): Set<string> {
  const ids = new Set<string>();
  for (const [lng, lat] of coords) {
    const tileId = `${Math.floor(lat)}_${Math.floor(lng)}`;
    ids.add(tileId);
  }
  return ids;
}

/**
 * Build spatial tiles from a map of geoId → FeatureCollection.
 *
 * Each feature is assigned to every 1-degree tile its coordinates touch.
 * Cross-boundary features are duplicated into all relevant tiles.
 */
export function buildTiles(input: Map<string, FeatureCollection>): {
  tiles: Map<string, TileData>;
  manifest: TileManifestEntry[];
} {
  const tiles = new Map<string, TileData>();

  for (const [geoId, fc] of input) {
    for (let i = 0; i < fc.features.length; i++) {
      const feature = fc.features[i];
      const coords = extractCoordinates(feature);
      if (coords.length === 0) continue;

      const tileIds = tileIdsForCoordinates(coords);
      if (tileIds.size === 0) continue;

      // Build the enriched feature (clone to avoid mutating input)
      const enriched: Feature = {
        ...feature,
        properties: {
          ...feature.properties,
          _geoId: geoId,
          _fid: `${geoId}:${i}`,
        },
      };

      for (const tileId of tileIds) {
        let tile = tiles.get(tileId);
        if (!tile) {
          tile = {
            features: [],
            minLng: Infinity,
            minLat: Infinity,
            maxLng: -Infinity,
            maxLat: -Infinity,
          };
          tiles.set(tileId, tile);
        }
        tile.features.push(enriched);

        // Update bounding box from this feature's coordinates
        for (const [lng, lat] of coords) {
          if (lng < tile.minLng) tile.minLng = lng;
          if (lat < tile.minLat) tile.minLat = lat;
          if (lng > tile.maxLng) tile.maxLng = lng;
          if (lat > tile.maxLat) tile.maxLat = lat;
        }
      }
    }
  }

  // Build manifest, sorted by id for deterministic output
  const manifest: TileManifestEntry[] = [...tiles.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
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
  const geoDir = path.resolve('public', 'paths', 'geo');
  const tilesDir = path.join(geoDir, 'tiles');

  if (!fs.existsSync(geoDir)) {
    console.log(`[path-tiles] No geo directory at ${geoDir} — skipping`);
    process.exit(0);
  }

  const files = fs.readdirSync(geoDir).filter(f => f.endsWith('.geojson'));
  if (files.length === 0) {
    console.log('[path-tiles] No geojson files found — skipping');
    process.exit(0);
  }

  // Read all geojson files
  const input = new Map<string, FeatureCollection>();
  for (const file of files) {
    const geoId = file.replace('.geojson', '');
    const content = fs.readFileSync(path.join(geoDir, file), 'utf-8');
    input.set(geoId, JSON.parse(content) as FeatureCollection);
  }

  const { tiles, manifest } = buildTiles(input);

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
