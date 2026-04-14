/**
 * Resolves geoIds to loaded tile features.
 *
 * The correct order of operations for tile data:
 *   1. Know what you need (geoIds)
 *   2. Find where it lives (geoId → slug → tile IDs)
 *   3. Load those tiles
 *   4. Return the features
 *
 * Chain: geoId → geo-metadata.json → slug → slug-index.json → tile IDs
 *
 * Never compute bounds from partially-loaded data.
 * Never eager-load all tiles.
 * Never depend on the current viewport for data availability.
 */

import type { TileLoader } from './tile-loader';

interface GeoMetaEntry {
  slug: string;
}

interface SlugIndexEntry {
  tiles: string[];
}

let geoMetaCache: Record<string, GeoMetaEntry> | null = null;
let slugIndexCache: Record<string, SlugIndexEntry> | null = null;
let geoMetaPromise: Promise<Record<string, GeoMetaEntry>> | null = null;
let slugIndexPromise: Promise<Record<string, SlugIndexEntry>> | null = null;

async function fetchGeoMeta(): Promise<Record<string, GeoMetaEntry>> {
  if (geoMetaCache) return geoMetaCache;
  if (!geoMetaPromise) {
    geoMetaPromise = fetch('/bike-paths/geo/geo-metadata.json')
      .then(r => r.ok ? r.json() : {})
      .catch(() => ({}));
  }
  geoMetaCache = await geoMetaPromise;
  return geoMetaCache;
}

async function fetchSlugIndex(): Promise<Record<string, SlugIndexEntry>> {
  if (slugIndexCache) return slugIndexCache;
  if (!slugIndexPromise) {
    slugIndexPromise = fetch('/bike-paths/geo/tiles/slug-index.json')
      .then(r => r.ok ? r.json() : {})
      .catch(() => ({}));
  }
  slugIndexCache = await slugIndexPromise;
  return slugIndexCache;
}

/**
 * Resolve geoIds to the tile IDs that contain their features.
 * Returns a deduplicated set of tile IDs.
 */
export async function resolveTileIds(geoIds: string[]): Promise<string[]> {
  const [geoMeta, slugIndex] = await Promise.all([fetchGeoMeta(), fetchSlugIndex()]);

  const tileIds = new Set<string>();
  for (const geoId of geoIds) {
    const meta = geoMeta[geoId];
    if (!meta) continue;
    const entry = slugIndex[meta.slug];
    if (!entry) continue;
    for (const tileId of entry.tiles) tileIds.add(tileId);
  }
  return [...tileIds];
}

/**
 * Load specific tiles by ID, then return features matching the geoIds.
 */
export async function loadFeaturesForGeoIds(
  tileLoader: TileLoader,
  geoIds: string[],
): Promise<GeoJSON.Feature[]> {
  const tileIds = await resolveTileIds(geoIds);
  if (tileIds.length === 0) return [];

  // Load exactly the tiles we need
  await tileLoader.loadTilesByIds(tileIds);

  // Filter to the requested geoIds
  const geoIdSet = new Set(geoIds);
  return tileLoader.allLoadedFeatures().filter(
    f => f.properties?.relationId && geoIdSet.has(f.properties.relationId),
  );
}
