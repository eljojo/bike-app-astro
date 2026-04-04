/**
 * Single-pass GeoJSON file reader with module-level cache.
 *
 * Reads each GeoJSON file once and extracts all needed data:
 * - sampled points (for spatial indexing and map display)
 * - total length in km (for path facts)
 * - elevation gain/loss (from 3D coordinates if present)
 *
 * Replaces the separate readGeoPoints(), readGeoLengthKm(),
 * loadGeoCoordinates(), and loadGeoElevation() functions that
 * previously re-read each file multiple times.
 */
import fs from 'node:fs';
import path from 'node:path';
import { sampleGeoJsonPoints, SAMPLE_INTERVAL } from './geojson-sampling';
import { haversineM } from './proximity';

export interface GeoFileData {
  points: Array<{ lat: number; lng: number }>;
  lengthKm: number;
  elevation: { gain_m: number; loss_m: number } | null;
}

/** Module-level cache: file path -> parsed data. */
const geoFileCache = new Map<string, GeoFileData>();

/** Parse a single GeoJSON file and extract all needed data in one pass. */
function parseGeoFile(filePath: string): GeoFileData {
  const cached = geoFileCache.get(filePath);
  if (cached) return cached;

  if (!fs.existsSync(filePath)) {
    const empty: GeoFileData = { points: [], lengthKm: 0, elevation: null };
    geoFileCache.set(filePath, empty);
    return empty;
  }

  try {
    const geojson = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const points = sampleGeoJsonPoints(geojson, SAMPLE_INTERVAL);

    let totalM = 0;
    let gain = 0;
    let loss = 0;
    let hasElevation = false;

    for (const feature of geojson.features ?? []) {
      const geomType = feature.geometry?.type;
      const lineArrays: number[][][] =
        geomType === 'LineString' ? [feature.geometry.coordinates] :
        geomType === 'MultiLineString' ? feature.geometry.coordinates :
        [];
      for (const coords of lineArrays) {
        for (let i = 1; i < coords.length; i++) {
          totalM += haversineM(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
          if (coords[i].length >= 3 && coords[i - 1].length >= 3) {
            const delta = coords[i][2] - coords[i - 1][2];
            if (delta > 0) gain += delta;
            else loss -= delta;
            hasElevation = true;
          }
        }
      }
    }

    const result: GeoFileData = {
      points,
      lengthKm: totalM / 1000,
      elevation: hasElevation && (gain > 0 || loss > 0)
        ? { gain_m: Math.round(gain), loss_m: Math.round(loss) }
        : null,
    };
    geoFileCache.set(filePath, result);
    return result;
  } catch {
    const empty: GeoFileData = { points: [], lengthKm: 0, elevation: null };
    geoFileCache.set(filePath, empty);
    return empty;
  }
}

/** Read a single GeoJSON file (cached). */
export function readGeoFileData(filePath: string): GeoFileData {
  return parseGeoFile(filePath);
}

/**
 * Load all GeoJSON files from a directory, returning data keyed by identifier.
 * Keys are: relation ID for "{id}.geojson", "name-{slug}" for named, etc.
 */
export function loadAllGeoData(geoDir: string): {
  coordinates: Record<string, Array<{ lat: number; lng: number }>>;
  elevation: Record<string, { gain_m: number; loss_m: number }>;
} {
  if (!fs.existsSync(geoDir)) return { coordinates: {}, elevation: {} };

  const coordinates: Record<string, Array<{ lat: number; lng: number }>> = {};
  const elevation: Record<string, { gain_m: number; loss_m: number }> = {};

  for (const file of fs.readdirSync(geoDir).filter(f => f.endsWith('.geojson'))) {
    const key = file.replace(/\.geojson$/, '');
    const filePath = path.join(geoDir, file);
    const data = parseGeoFile(filePath);
    if (data.points.length > 0) coordinates[key] = data.points;
    if (data.elevation) elevation[key] = data.elevation;
  }

  return { coordinates, elevation };
}
