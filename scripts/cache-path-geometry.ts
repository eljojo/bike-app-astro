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

// Server rotation — private.coffee has no rate limit and 4 servers with 256GB RAM each.
const OVERPASS_SERVERS = [
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
