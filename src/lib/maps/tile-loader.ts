/**
 * Client-side tile loader for path GeoJSON tiles.
 * Browser-safe — no Node.js APIs, no .server suffix.
 *
 * Loads tiles on demand based on viewport bounds, with caching,
 * in-flight deduplication, and cross-tile feature deduplication.
 */

import type { Feature, FeatureCollection } from 'geojson';

import type { TileManifestEntry } from './tile-types';
export type { TileManifestEntry };

export interface TileLoader {
  loadTilesForBounds(bounds: [number, number, number, number]): Promise<Feature[]>;
  loadTilesByIds(tileIds: string[]): Promise<Feature[]>;
  allLoadedFeatures(): Feature[];
}

function bboxIntersects(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function createTileLoader(manifest: TileManifestEntry[], basePath: string): TileLoader {
  const cachedFeatures = new Map<string, Feature[]>();
  const inFlight = new Map<string, Promise<Feature[]>>();
  /** IDs of tiles that contributed to the current allFeatures snapshot. */
  let loadedTileIds = new Set<string>();
  /** Deduplicated features from all loaded tiles — rebuilt when new tiles arrive. */
  let allFeatures: Feature[] = [];

  async function fetchTile(entry: TileManifestEntry): Promise<Feature[]> {
    const url = `${basePath}${entry.file}`;
    try {
      const response = await fetch(url);
      if (!response.ok) return [];
      const fc: FeatureCollection = await response.json();
      return fc.features;
    } catch {
      return [];
    }
  }

  function loadTile(entry: TileManifestEntry): Promise<Feature[]> {
    const cached = cachedFeatures.get(entry.id);
    if (cached) return Promise.resolve(cached);

    const existing = inFlight.get(entry.id);
    if (existing) return existing;

    const promise = fetchTile(entry).then((features) => {
      cachedFeatures.set(entry.id, features);
      inFlight.delete(entry.id);
      return features;
    });
    inFlight.set(entry.id, promise);
    return promise;
  }

  /** Rebuild allFeatures from the given tile IDs, deduplicating by _fid. */
  function rebuildFeatures(tileIds: Set<string>): Feature[] {
    const seenFids = new Set<string>();
    const features: Feature[] = [];
    for (const id of tileIds) {
      const tileFeatures = cachedFeatures.get(id);
      if (!tileFeatures) continue;
      for (const feature of tileFeatures) {
        const fid = feature.properties?._fid as string | undefined;
        if (fid && seenFids.has(fid)) continue;
        if (fid) seenFids.add(fid);
        features.push(feature);
      }
    }
    return features;
  }

  return {
    async loadTilesForBounds(bounds) {
      const matching = manifest.filter((entry) => bboxIntersects(entry.bounds, bounds));
      await Promise.all(matching.map((entry) => loadTile(entry)));

      // Rebuild features only when the set of loaded tiles has changed
      const matchingIds = new Set(matching.map((e) => e.id));
      // Include previously-loaded tiles too (panning back to an area should still show those)
      for (const id of loadedTileIds) matchingIds.add(id);
      if (matchingIds.size !== loadedTileIds.size) {
        loadedTileIds = matchingIds;
        allFeatures = rebuildFeatures(loadedTileIds);
      }

      return [...allFeatures];
    },

    async loadTilesByIds(tileIds: string[]) {
      const entries = tileIds
        .map(id => manifest.find(e => e.id === id))
        .filter((e): e is TileManifestEntry => !!e);
      await Promise.all(entries.map(entry => loadTile(entry)));

      const allIds = new Set(loadedTileIds);
      for (const id of tileIds) allIds.add(id);
      if (allIds.size !== loadedTileIds.size) {
        loadedTileIds = allIds;
        allFeatures = rebuildFeatures(loadedTileIds);
      }
      return [...allFeatures];
    },

    allLoadedFeatures() {
      return [...allFeatures];
    },
  };
}
