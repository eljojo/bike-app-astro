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
  const seenFids = new Set<string>();
  const allFeatures: Feature[] = [];

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

  return {
    async loadTilesForBounds(bounds) {
      const matching = manifest.filter((entry) => bboxIntersects(entry.bounds, bounds));
      const tileResults = await Promise.all(matching.map((entry) => loadTile(entry)));

      for (const features of tileResults) {
        for (const feature of features) {
          const fid = feature.properties?._fid as string | undefined;
          if (fid && seenFids.has(fid)) continue;
          if (fid) seenFids.add(fid);
          allFeatures.push(feature);
        }
      }

      return [...allFeatures];
    },

    allLoadedFeatures() {
      return [...allFeatures];
    },
  };
}
