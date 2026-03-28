/**
 * Fetch and cache bike path geometry from the Overpass API.
 *
 * Reads bikepaths.yml from CONTENT_DIR/{CITY}/, fetches OSM relation
 * geometry for each entry, and caches as GeoJSON in .cache/bikepath-geometry/{city}/.
 *
 * Incremental: skips relations already cached. Safe to re-run.
 * Uses server rotation (private.coffee primary, overpass-api.de fallback)
 * with retry logic matching the bike-routes Overpass client pattern.
 *
 * Usage:
 *   npx tsx scripts/cache-path-geometry.ts
 *   npx tsx scripts/cache-path-geometry.ts --dry-run
 *
 * Env: CONTENT_DIR (default: ~/code/bike-routes), CITY (default: ottawa)
 */
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const CITY = process.env.CITY || 'ottawa';
const CONTENT_DIR = process.env.CONTENT_DIR || path.join(process.env.HOME!, 'code', 'bike-routes');
const CACHE_DIR = path.resolve('.cache', 'bikepath-geometry', CITY);
const dryRun = process.argv.includes('--dry-run');

// Server rotation — try our own server first, then public fallbacks.
const OVERPASS_SERVERS = [
  'https://overpass.whereto.bike/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

interface BikePathEntry {
  name: string;
  osm_relations?: number[];
}

/**
 * Fetch an Overpass query with server rotation and retry.
 * Matches the retry pattern from bike-routes/scripts/lib/overpass.mjs.
 */
async function queryOverpass(query: string): Promise<any> {
  for (let attempt = 0; attempt < OVERPASS_SERVERS.length * 2; attempt++) {
    const serverIdx = Math.floor(attempt / 2) % OVERPASS_SERVERS.length;
    const serverUrl = process.env.OVERPASS_URL || OVERPASS_SERVERS[serverIdx];

    let res: Response;
    try {
      res = await fetch(serverUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });
    } catch (err: any) {
      console.log(`  [overpass] ${serverUrl} network error: ${err.message}`);
      continue;
    }

    if (res.ok) {
      const text = await res.text();
      // Overpass sometimes returns XML error pages with 200 OK
      if (text.startsWith('<?xml') || text.startsWith('<html')) {
        console.log(`  [overpass] ${serverUrl} returned XML instead of JSON, retrying...`);
        const wait = (attempt + 1) * 10;
        await new Promise(r => setTimeout(r, wait * 1000));
        continue;
      }
      return JSON.parse(text);
    }

    if ([429, 502, 503, 504].includes(res.status)) {
      const wait = (attempt + 1) * 10;
      const nextServer = OVERPASS_SERVERS[(serverIdx + 1) % OVERPASS_SERVERS.length];
      console.log(`  [overpass] ${serverUrl} returned ${res.status}, trying ${new URL(nextServer).hostname} in ${wait}s...`);
      await new Promise(r => setTimeout(r, wait * 1000));
      continue;
    }

    throw new Error(`Overpass API error ${res.status}: ${await res.text()}`);
  }

  throw new Error('Overpass API: all servers failed after retries');
}

function overpassToGeoJSON(data: any, relationId: number): GeoJSON.FeatureCollection {
  const ways = data.elements.filter((e: any) => e.type === 'way' && e.geometry);
  const features = ways.map((way: any) => ({
    type: 'Feature' as const,
    properties: { wayId: way.id, relationId },
    geometry: {
      type: 'LineString' as const,
      coordinates: way.geometry.map((p: any) => [p.lon, p.lat]),
    },
  }));
  return { type: 'FeatureCollection', features };
}

// --- Main ---

const ymlPath = path.join(CONTENT_DIR, CITY, 'bikepaths.yml');

if (!fs.existsSync(ymlPath)) {
  console.log(`[path-geo] No bikepaths.yml at ${ymlPath} — skipping`);
  process.exit(0);
}

const raw = yaml.load(fs.readFileSync(ymlPath, 'utf-8')) as { bike_paths: BikePathEntry[] };
const entries = raw.bike_paths.filter(e => e.osm_relations && e.osm_relations.length > 0);

console.log(`[path-geo] ${entries.length} entries with OSM relations (${raw.bike_paths.length} total)`);

if (!dryRun) fs.mkdirSync(CACHE_DIR, { recursive: true });

let fetched = 0;
let skipped = 0;

for (const entry of entries) {
  for (const relId of entry.osm_relations!) {
    const outPath = path.join(CACHE_DIR, `${relId}.geojson`);

    if (fs.existsSync(outPath)) {
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`  Would fetch: relation ${relId} (${entry.name})`);
      continue;
    }

    console.log(`  Fetching relation ${relId} (${entry.name})...`);
    try {
      const query = `[out:json][timeout:60];relation(${relId});(._;>;);out geom;`;
      const data = await queryOverpass(query);
      const geojson = overpassToGeoJSON(data, relId);
      fs.writeFileSync(outPath, JSON.stringify(geojson));
      fetched++;
    } catch (err: any) {
      console.error(`  Error: ${err.message}`);
    }
  }
}

console.log(`[path-geo] Done. Fetched: ${fetched}, Cached: ${skipped}`);

// --- Second pass: enrich with elevation from Open-Meteo ---
if (!dryRun) {
  const { fetchElevations, downsamplePoints } = await import('../src/lib/geo/elevation-enrichment');
  type GeoPoint = { lon: number; lat: number };

  function hasElevation(geojson: any): boolean {
    for (const feature of geojson.features ?? []) {
      if (feature.geometry?.type === 'LineString' && feature.geometry.coordinates?.length > 0) {
        return feature.geometry.coordinates[0].length >= 3;
      }
    }
    return false;
  }

  const cachedFiles = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.geojson'));
  const needsElevation = cachedFiles.filter(f => {
    const geojson = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), 'utf-8'));
    return !hasElevation(geojson);
  });

  if (needsElevation.length > 0) {
    console.log(`[path-geo] Enriching ${needsElevation.length} files with elevation...`);
    let enriched = 0;

    for (const file of needsElevation) {
      const filePath = path.join(CACHE_DIR, file);
      const geojson = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      // Collect all coordinates
      const allCoords: { featureIdx: number; coordIdx: number; point: GeoPoint }[] = [];
      for (let fi = 0; fi < (geojson.features ?? []).length; fi++) {
        const feature = geojson.features[fi];
        if (feature.geometry?.type !== 'LineString') continue;
        for (let ci = 0; ci < feature.geometry.coordinates.length; ci++) {
          const [lng, lat] = feature.geometry.coordinates[ci];
          allCoords.push({ featureIdx: fi, coordIdx: ci, point: { lon: lng, lat } });
        }
      }

      if (allCoords.length === 0) continue;

      const points = allCoords.map(c => c.point);
      const { sampled, indices } = downsamplePoints(points, 500);
      const elevations = await fetchElevations(sampled);

      if (!elevations) {
        console.log(`  ${file}: elevation fetch failed, skipping`);
        // Delay before next attempt to avoid hammering a rate-limited API
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

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

      // Write back as 3D coordinates [lng, lat, ele]
      for (let i = 0; i < allCoords.length; i++) {
        const { featureIdx, coordIdx } = allCoords[i];
        const [lng, lat] = geojson.features[featureIdx].geometry.coordinates[coordIdx];
        geojson.features[featureIdx].geometry.coordinates[coordIdx] = [lng, lat, Math.round(allElevations[i])];
      }

      fs.writeFileSync(filePath, JSON.stringify(geojson));
      enriched++;
      console.log(`  ${file}: enriched with elevation`);

      // Delay between files to be polite to Open-Meteo
      await new Promise(r => setTimeout(r, 500));
    }

    console.log(`[path-geo] Elevation enrichment done. Enriched: ${enriched}/${needsElevation.length}`);
  } else {
    console.log(`[path-geo] All ${cachedFiles.length} files already have elevation data`);
  }
}
