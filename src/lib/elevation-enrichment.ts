/**
 * Elevation enrichment service.
 *
 * Fetches elevation data from the Open-Meteo API and interpolates it
 * across a set of GPS track points. Used when importing routes that
 * lack elevation (e.g. Google Maps KML exports).
 */

export interface GeoPoint {
  lon: number;
  lat: number;
}

export interface ElevationPoint extends GeoPoint {
  ele: number;
}

// ── downsamplePoints ────────────────────────────────────────────────

/**
 * Evenly downsample an array of points to at most `maxPoints`,
 * always including the first and last point.
 */
export function downsamplePoints(
  points: GeoPoint[],
  maxPoints: number,
): { sampled: GeoPoint[]; indices: number[] } {
  if (points.length <= maxPoints) {
    return {
      sampled: [...points],
      indices: points.map((_, i) => i),
    };
  }

  const indices: number[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round((i * (points.length - 1)) / (maxPoints - 1));
    indices.push(idx);
  }

  return {
    sampled: indices.map((i) => points[i]),
    indices,
  };
}

// ── interpolateElevations ───────────────────────────────────────────

/**
 * Assign fetched elevations at sampled indices and linearly interpolate
 * elevation for all points between samples.
 */
export function interpolateElevations(
  points: GeoPoint[],
  sampledIndices: number[],
  elevations: number[],
): ElevationPoint[] {
  const result: ElevationPoint[] = points.map((p) => ({ ...p, ele: 0 }));

  // Set known elevations
  for (let i = 0; i < sampledIndices.length; i++) {
    result[sampledIndices[i]].ele = elevations[i];
  }

  // Linearly interpolate between each pair of sampled indices
  for (let s = 0; s < sampledIndices.length - 1; s++) {
    const startIdx = sampledIndices[s];
    const endIdx = sampledIndices[s + 1];
    const startEle = elevations[s];
    const endEle = elevations[s + 1];
    const span = endIdx - startIdx;

    for (let i = startIdx + 1; i < endIdx; i++) {
      const t = (i - startIdx) / span;
      result[i].ele = startEle + t * (endEle - startEle);
    }
  }

  return result;
}

// ── buildGpxFromPoints ──────────────────────────────────────────────

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Build a GPX XML string from points with optional elevation.
 * Includes `<ele>` only when the `ele` property is defined.
 */
export function buildGpxFromPoints(
  name: string,
  points: (GeoPoint & { ele?: number })[],
): string {
  const trkpts = points
    .map((p) => {
      const ele = p.ele !== undefined ? `<ele>${p.ele}</ele>` : '';
      return `      <trkpt lat="${p.lat}" lon="${p.lon}">${ele}</trkpt>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="whereto.bike">
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

// ── fetchElevations ─────────────────────────────────────────────────

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/elevation';
const BATCH_SIZE = 100;
const TIMEOUT_MS = 5000;

/**
 * Fetch elevation data from Open-Meteo API.
 * Batches into groups of 100 (API limit).
 * Returns null on error (graceful fallback).
 */
export async function fetchElevations(
  points: GeoPoint[],
): Promise<number[] | null> {
  try {
    const allElevations: number[] = [];

    for (let i = 0; i < points.length; i += BATCH_SIZE) {
      const batch = points.slice(i, i + BATCH_SIZE);
      const lats = batch.map((p) => p.lat).join(',');
      const lons = batch.map((p) => p.lon).join(',');

      const url = `${OPEN_METEO_URL}?latitude=${lats}&longitude=${lons}`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        console.error(
          `Open-Meteo API error: ${response.status} ${response.statusText}`,
        );
        return null;
      }

      const data = await response.json();
      const elevations: number[] = Array.isArray(data.elevation)
        ? data.elevation
        : [data.elevation];
      allElevations.push(...elevations);
    }

    return allElevations;
  } catch (err) {
    console.error('Failed to fetch elevations:', err);
    return null;
  }
}

// ── enrichWithElevation ─────────────────────────────────────────────

const DEFAULT_MAX_SAMPLES = 500;

/**
 * Full pipeline: downsample to 500 points, fetch elevations, interpolate.
 * Falls back to original points (without elevation) if fetch fails.
 */
export async function enrichWithElevation(
  points: GeoPoint[],
): Promise<(GeoPoint & { ele?: number })[]> {
  const { sampled, indices } = downsamplePoints(points, DEFAULT_MAX_SAMPLES);

  const elevations = await fetchElevations(sampled);
  if (!elevations) {
    return points;
  }

  return interpolateElevations(points, indices, elevations);
}
