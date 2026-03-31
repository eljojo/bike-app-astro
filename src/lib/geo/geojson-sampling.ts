/**
 * Shared GeoJSON geometry sampling utilities.
 *
 * Browser-safe — no Node.js APIs. Used by both bike-path-entries.server.ts
 * (Vite config time) and build-data-plugin.ts (build time).
 */

/** Default sampling interval: keep every Nth coordinate. */
export const SAMPLE_INTERVAL = 10;

/** A lat/lng point extracted from GeoJSON geometry. */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/**
 * Extract line coordinate arrays from a GeoJSON feature geometry.
 * Handles both LineString and MultiLineString.
 */
function getLineArrays(feature: { geometry?: { type?: string; coordinates?: unknown } }): number[][][] {
  const geomType = feature.geometry?.type;
  if (geomType === 'LineString') return [feature.geometry!.coordinates as number[][]];
  if (geomType === 'MultiLineString') return feature.geometry!.coordinates as number[][][];
  return [];
}

/**
 * Sample points from a parsed GeoJSON FeatureCollection.
 * Keeps every `interval`th point plus the last point of each line.
 */
export function sampleGeoJsonPoints(
  geojson: { features?: Array<{ geometry?: { type?: string; coordinates?: unknown } }> },
  interval: number = SAMPLE_INTERVAL,
): GeoPoint[] {
  const points: GeoPoint[] = [];
  for (const feature of geojson.features ?? []) {
    for (const coords of getLineArrays(feature)) {
      for (let i = 0; i < coords.length; i += interval) {
        points.push({ lat: coords[i][1], lng: coords[i][0] });
      }
      // Include last point if not already sampled
      if (coords.length > 0 && coords.length % interval !== 0) {
        const last = coords[coords.length - 1];
        points.push({ lat: last[1], lng: last[0] });
      }
    }
  }
  return points;
}
