/**
 * Bike path data module — the public API for bike path data.
 *
 * This file is REPLACED at build time by build-data-plugin.ts with generated code
 * that inlines all data. The source version here is used in dev mode only.
 *
 * The canonical merge logic lives in bike-path-entries.server.ts, which is NOT
 * subject to the build transform and can be used at Vite config time.
 */
import { haversineM } from '../geo/proximity';
import type { GpxPoint } from '../gpx/parse';

// Re-export everything from the canonical entries module
export { loadBikePathEntries, normalizeOperator } from './bike-path-entries.server';
export type { BikePathPage } from './bike-path-entries.server';

// Re-export the type for downstream consumers
import { loadBikePathEntries } from './bike-path-entries.server';
import type { BikePathPage } from './bike-path-entries.server';
import type { SluggedBikePathYml } from './bikepaths-yml';

/** Load all bike path data — async wrapper that delegates to loadBikePathEntries(). */
export async function loadBikePathData(): Promise<{
  pages: BikePathPage[];
  allYmlEntries: SluggedBikePathYml[];
  geoFiles: string[];
}> {
  return loadBikePathEntries();
}

/** Get precomputed route → paths mapping without loading the full bike path dataset. */
export function getRouteToPaths(): Record<string, Array<{ slug: string; name: string; surface?: string }>> {
  return {}; // Precomputed in build-data-plugin; empty in dev mode
}

/** Check if a GPX track passes near any of a bike path's anchor points. */
export function routePassesNearPath(
  trackPoints: GpxPoint[],
  pathAnchors: { lat: number; lng: number }[],
  thresholdM: number = 100,
): boolean {
  for (const anchor of pathAnchors) {
    for (const tp of trackPoints) {
      if (haversineM(tp.lat, tp.lon, anchor.lat, anchor.lng) <= thresholdM) {
        return true;
      }
    }
  }
  return false;
}
