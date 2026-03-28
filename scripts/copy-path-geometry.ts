/**
 * Copy cached bike path GeoJSON geometry to public/paths/geo/.
 * Enriches coordinates with elevation data from Open-Meteo if missing.
 *
 * The cache lives at .cache/bikepath-geometry/{city}/ in the astro repo,
 * populated by scripts/cache-path-geometry.ts (Overpass API fetch).
 *
 * Elevation is stored as 3D coordinates [lng, lat, ele] directly in the
 * GeoJSON — once enriched, the cache file is updated so subsequent runs
 * skip the API call.
 *
 * This script runs as part of prebuild.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fetchElevations, downsamplePoints } from '../src/lib/geo/elevation-enrichment';
import type { GeoPoint } from '../src/lib/geo/elevation-enrichment';

const CITY = process.env.CITY || 'ottawa';
const cacheDir = path.resolve('.cache', 'bikepath-geometry', CITY);
const outDir = path.join('public', 'paths', 'geo');

if (!fs.existsSync(cacheDir)) {
  console.log(`[path-geo] No geometry cache at ${cacheDir} — skipping`);
  process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });

const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.geojson'));
if (files.length === 0) {
  console.log('[path-geo] Cache directory empty — skipping');
  process.exit(0);
}

/** Check if a GeoJSON file already has elevation (3D coordinates). */
function hasElevation(geojson: any): boolean {
  for (const feature of geojson.features ?? []) {
    if (feature.geometry?.type === 'LineString' && feature.geometry.coordinates?.length > 0) {
      // If the first coordinate has 3 elements, elevation is present
      return feature.geometry.coordinates[0].length >= 3;
    }
  }
  return false;
}

/** Enrich a GeoJSON file with elevation data from Open-Meteo. */
async function enrichGeoJSON(geojson: any): Promise<boolean> {
  // Collect all coordinates across all LineString features
  const allCoords: { featureIdx: number; coordIdx: number; point: GeoPoint }[] = [];
  for (let fi = 0; fi < (geojson.features ?? []).length; fi++) {
    const feature = geojson.features[fi];
    if (feature.geometry?.type !== 'LineString') continue;
    for (let ci = 0; ci < feature.geometry.coordinates.length; ci++) {
      const [lng, lat] = feature.geometry.coordinates[ci];
      allCoords.push({ featureIdx: fi, coordIdx: ci, point: { lon: lng, lat } });
    }
  }

  if (allCoords.length === 0) return false;

  // Downsample to 500 points for the API call, then interpolate back
  const points = allCoords.map(c => c.point);
  const { sampled, indices } = downsamplePoints(points, 500);
  const elevations = await fetchElevations(sampled);
  if (!elevations) return false;

  // Interpolate elevations for all points
  const allElevations = new Float64Array(points.length);
  for (let i = 0; i < indices.length - 1; i++) {
    const startIdx = indices[i];
    const endIdx = indices[i + 1];
    const startEle = elevations[i];
    const endEle = elevations[i + 1];
    for (let j = startIdx; j <= endIdx; j++) {
      const t = endIdx === startIdx ? 0 : (j - startIdx) / (endIdx - startIdx);
      allElevations[j] = startEle + t * (endEle - startEle);
    }
  }

  // Write elevation back as 3D coordinates [lng, lat, ele]
  for (let i = 0; i < allCoords.length; i++) {
    const { featureIdx, coordIdx } = allCoords[i];
    const [lng, lat] = geojson.features[featureIdx].geometry.coordinates[coordIdx];
    geojson.features[featureIdx].geometry.coordinates[coordIdx] = [lng, lat, Math.round(allElevations[i])];
  }

  return true;
}

let copied = 0;
let enriched = 0;

for (const file of files) {
  const cachePath = path.join(cacheDir, file);
  const geojson = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));

  if (!hasElevation(geojson)) {
    const ok = await enrichGeoJSON(geojson);
    if (ok) {
      // Write enriched version back to cache so next run skips the API call
      fs.writeFileSync(cachePath, JSON.stringify(geojson));
      enriched++;
    }
  }

  fs.writeFileSync(path.join(outDir, file), JSON.stringify(geojson));
  copied++;
}

console.log(`[path-geo] Copied ${copied} geometry files to ${outDir}/ (${enriched} enriched with elevation)`);
