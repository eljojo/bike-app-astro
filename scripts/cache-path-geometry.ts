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
 *   npx tsx scripts/cache-path-geometry.ts --force    # re-fetch all, ignoring cache
 *
 * Env: CONTENT_DIR (default: ~/code/bike-routes), CITY (default: ottawa)
 */
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { slugifyBikePathName } from '../src/lib/bike-paths/bikepaths-yml';

const CITY = process.env.CITY || 'ottawa';
const CONTENT_DIR = process.env.CONTENT_DIR || path.join(process.env.HOME!, 'code', 'bike-routes');
const CACHE_DIR = path.resolve('.cache', 'bikepath-geometry', CITY);
const dryRun = process.argv.includes('--dry-run');
const forceRefresh = process.argv.includes('--force');

// Server rotation — try our own server first, then public fallbacks.
const OVERPASS_SERVERS = [
  'https://overpass.whereto.bike/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

interface BikePathEntry {
  name: string;
  osm_relations?: number[];
  osm_names?: string[];
  anchors?: Array<[number, number]>; // [lng, lat] tuples
  segments?: Array<{ osm_way: number; [k: string]: unknown }>;
  parallel_to?: string;
}

/**
 * Fetch an Overpass query with server rotation and retry.
 * On failure, immediately rotate to the next server rather than retrying the same one.
 * Each server gets up to 2 attempts across the full rotation.
 */
async function queryOverpass(query: string): Promise<any> {
  const servers = process.env.OVERPASS_URL
    ? [process.env.OVERPASS_URL, ...OVERPASS_SERVERS.filter(s => s !== process.env.OVERPASS_URL)]
    : OVERPASS_SERVERS;
  const MAX_ROUNDS = 2; // try the full server list up to 2 times

  for (let round = 0; round < MAX_ROUNDS; round++) {
    for (let si = 0; si < servers.length; si++) {
      const serverUrl = servers[si];

      let res: Response;
      try {
        res = await fetch(serverUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(90_000),
        });
      } catch (err: any) {
        console.log(`  [overpass] ${new URL(serverUrl).hostname} network error: ${err.message}, rotating...`);
        continue;
      }

      if (res.ok) {
        const text = await res.text();
        // Overpass sometimes returns XML error pages with 200 OK
        if (text.startsWith('<?xml') || text.startsWith('<html')) {
          console.log(`  [overpass] ${new URL(serverUrl).hostname} returned XML instead of JSON, rotating...`);
          continue;
        }
        return JSON.parse(text);
      }

      if ([429, 502, 503, 504].includes(res.status)) {
        console.log(`  [overpass] ${new URL(serverUrl).hostname} returned ${res.status}, rotating...`);
        continue;
      }

      throw new Error(`Overpass API error ${res.status}: ${await res.text()}`);
    }

    // Finished one full round of all servers — wait before retrying
    if (round < MAX_ROUNDS - 1) {
      const wait = (round + 1) * 15;
      console.log(`  [overpass] All servers failed, retrying in ${wait}s...`);
      await new Promise(r => setTimeout(r, wait * 1000));
    }
  }

  throw new Error('Overpass API: all servers failed after retries');
}

function overpassToGeoJSON(data: any, id: number | string): GeoJSON.FeatureCollection {
  const ways = data.elements.filter((e: any) => e.type === 'way' && e.geometry);
  const features = ways.map((way: any) => ({
    type: 'Feature' as const,
    properties: { wayId: way.id, sourceId: id },
    geometry: {
      type: 'LineString' as const,
      coordinates: way.geometry.map((p: any) => [p.lon, p.lat]),
    },
  }));
  return { type: 'FeatureCollection', features };
}

const slugify = slugifyBikePathName;

/** Build Overpass bbox from anchor coordinates: south,west,north,east */
function anchorBbox(anchors: Array<[number, number]>): string {
  const lngs = anchors.map(a => a[0]);
  const lats = anchors.map(a => a[1]);
  const pad = 0.005; // ~500m padding
  return `${Math.min(...lats) - pad},${Math.min(...lngs) - pad},${Math.max(...lats) + pad},${Math.max(...lngs) + pad}`;
}

// --- Main ---

const ymlPath = path.join(CONTENT_DIR, CITY, 'bikepaths.yml');

if (!fs.existsSync(ymlPath)) {
  console.log(`[path-geo] No bikepaths.yml at ${ymlPath} — skipping`);
  process.exit(0);
}

const raw = yaml.load(fs.readFileSync(ymlPath, 'utf-8')) as { bike_paths: BikePathEntry[] };
const relationEntries = raw.bike_paths.filter(e => e.osm_relations && e.osm_relations.length > 0);
const nameEntries = raw.bike_paths.filter(e => (!e.osm_relations || e.osm_relations.length === 0) && e.osm_names && e.osm_names.length > 0 && e.anchors && e.anchors.length >= 2);
const segmentEntries = raw.bike_paths.filter(e => e.segments && e.segments.length > 0 && (!e.osm_relations || e.osm_relations.length === 0));

console.log(`[path-geo] ${relationEntries.length} relations + ${nameEntries.length} named + ${segmentEntries.length} segmented (${raw.bike_paths.length} total)`);

if (!dryRun) fs.mkdirSync(CACHE_DIR, { recursive: true });

let fetched = 0;
let skipped = 0;

// --- Pass 1: Relation-based entries ---
for (const entry of relationEntries) {
  for (const relId of entry.osm_relations!) {
    const outPath = path.join(CACHE_DIR, `${relId}.geojson`);

    if (fs.existsSync(outPath) && !forceRefresh) {
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`  Would fetch: relation ${relId} (${entry.name})${forceRefresh ? ' (force)' : ''}`);
      continue;
    }

    console.log(`  Fetching relation ${relId} (${entry.name})${forceRefresh ? ' (force refresh)' : ''}...`);
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

// --- Pass 2: Name-based entries (query ways by name within anchor bbox) ---
for (const entry of nameEntries) {
  const slug = slugify(entry.name);
  const outPath = path.join(CACHE_DIR, `name-${slug}.geojson`);

  if (fs.existsSync(outPath) && !forceRefresh) {
    skipped++;
    continue;
  }

  if (dryRun) {
    console.log(`  Would fetch by name: ${entry.osm_names![0]} (${entry.name})`);
    continue;
  }

  console.log(`  Fetching by name: ${entry.osm_names![0]} (${entry.name})...`);
  try {
    const bbox = anchorBbox(entry.anchors!);
    // Query all ways matching any of the osm_names within the bbox
    // Escape double quotes in OSM names to prevent Overpass QL injection
    const nameFilters = entry.osm_names!.map(n => `way["name"="${n.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"](${bbox});`).join('\n');
    const query = `[out:json][timeout:60];\n(\n${nameFilters}\n);\nout geom;`;
    const data = await queryOverpass(query);
    const geojson = overpassToGeoJSON(data, slug);
    if (geojson.features.length > 0) {
      fs.writeFileSync(outPath, JSON.stringify(geojson));
      fetched++;
    } else {
      console.log(`  No ways found for ${entry.name}`);
    }
  } catch (err: any) {
    console.error(`  Error: ${err.message}`);
  }
}

// --- Pass 3: Segment-based entries (query individual ways by ID) ---
for (const entry of segmentEntries) {
  const slug = slugify(entry.name);
  const outPath = path.join(CACHE_DIR, `seg-${slug}.geojson`);

  if (fs.existsSync(outPath) && !forceRefresh) {
    skipped++;
    continue;
  }

  if (dryRun) {
    console.log(`  Would fetch segments: ${entry.segments!.length} ways (${entry.name})`);
    continue;
  }

  console.log(`  Fetching ${entry.segments!.length} segments (${entry.name})...`);
  try {
    const wayIds = entry.segments!.map(s => s.osm_way);
    const query = `[out:json][timeout:60];\n(\n${wayIds.map(id => `way(${id});`).join('\n')}\n);\nout geom;`;
    const data = await queryOverpass(query);
    const geojson = overpassToGeoJSON(data, slug);
    if (geojson.features.length > 0) {
      fs.writeFileSync(outPath, JSON.stringify(geojson));
      fetched++;
    } else {
      console.log(`  No ways found for ${entry.name}`);
    }
  } catch (err: any) {
    console.error(`  Error: ${err.message}`);
  }
}

// --- Pass 4: Parallel-to entries — unnamed cycleways alongside named roads ---
const parallelEntries = raw.bike_paths.filter(
  (e: BikePathEntry) => e.parallel_to && (!e.osm_relations || e.osm_relations.length === 0),
);

if (parallelEntries.length > 0) {
  console.log(`\nPass 4: Fetching geometry for ${parallelEntries.length} parallel-to entries...`);

  for (const entry of parallelEntries) {
    const slug = slugify(entry.name);
    const outFile = path.join(CACHE_DIR, `parallel-${slug}.geojson`);

    if (!forceRefresh && fs.existsSync(outFile)) {
      skipped++;
      continue;
    }

    if (!entry.anchors || entry.anchors.length < 2) {
      console.log(`  [skip] ${entry.name} — no anchors for bbox`);
      continue;
    }

    const bbox = anchorBbox(entry.anchors as Array<[number, number]>);
    const roadName = entry.parallel_to!.replace(/'/g, "\\'");

    const q = `[out:json][timeout:60];
way["name"="${roadName}"](${bbox}) -> .road;
way["highway"="cycleway"][!"name"](around.road:30);
(._;>;);
out geom;`;

    if (dryRun) {
      console.log(`  [dry-run] parallel-${slug}: ${entry.parallel_to}`);
      continue;
    }

    try {
      const data = await queryOverpass(q);
      const geojson = overpassToGeoJSON(data, `parallel-${slug}`);
      if (geojson.features.length === 0) {
        console.log(`  [empty] parallel-${slug}: no geometry found`);
        continue;
      }

      fs.writeFileSync(outFile, JSON.stringify(geojson));
      fetched++;
      console.log(`  parallel-${slug}: ${geojson.features.length} features`);
    } catch (err: any) {
      console.error(`  [error] parallel-${slug}: ${err.message}`);
    }
  }
}

console.log(`[path-geo] Done. Fetched: ${fetched}, Cached: ${skipped}`);

// --- Elevation enrichment (featured paths only) ---
// Only enrich files belonging to featured bike paths (those with `featured: true`
// in their markdown frontmatter). Skips files that already have elevation data,
// so enriched files persist across cache restores without being overwritten.
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

  // --- Determine which cache files belong to featured paths ---

  // 1. Parse YML entries with canonical slugs (single source of truth)
  const { parseBikePathsYml } = await import('../src/lib/bike-paths/bikepaths-yml');
  const sluggedEntries = parseBikePathsYml(fs.readFileSync(ymlPath, 'utf-8'));
  const ymlBySlug = new Map(sluggedEntries.map(e => [e.slug, e]));

  // 2. Read markdown frontmatter to find featured paths and their includes
  const bikePathsDir = path.join(CONTENT_DIR, CITY, 'bike-paths');
  const featuredYmlSlugs = new Set<string>();

  if (fs.existsSync(bikePathsDir)) {
    for (const file of fs.readdirSync(bikePathsDir).filter(f => f.endsWith('.md'))) {
      const content = fs.readFileSync(path.join(bikePathsDir, file), 'utf-8');
      // Quick frontmatter check — no need for a full YAML parser
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) continue;
      const fm = frontmatterMatch[1];
      if (!fm.includes('featured: true')) continue;

      const mdSlug = file.replace(/\.md$/, '');

      // Collect includes
      const includes: string[] = [];
      let inIncludes = false;
      for (const line of fm.split('\n')) {
        if (line.trim().startsWith('includes:')) { inIncludes = true; continue; }
        if (inIncludes && line.trim().startsWith('- ')) {
          includes.push(line.trim().slice(2).trim());
        } else if (inIncludes && line.trim() !== '') {
          inIncludes = false;
        }
      }

      // Add the markdown slug itself + all includes
      for (const slug of includes.length > 0 ? includes : [mdSlug]) {
        featuredYmlSlugs.add(slug);
      }
    }
  }

  // 3. Collect cache filenames for featured entries
  const featuredCacheFiles = new Set<string>();
  for (const ymlSlug of featuredYmlSlugs) {
    const entry = ymlBySlug.get(ymlSlug);
    if (!entry) continue;
    // Relation-based files
    for (const relId of entry.osm_relations ?? []) {
      featuredCacheFiles.add(`${relId}.geojson`);
    }
    // Name-based files
    if ((!entry.osm_relations || entry.osm_relations.length === 0) && entry.osm_names?.length) {
      featuredCacheFiles.add(`name-${slugify(entry.name)}.geojson`);
    }
    // Segment-based files
    if (entry.segments?.length && (!entry.osm_relations || entry.osm_relations.length === 0)) {
      featuredCacheFiles.add(`seg-${slugify(entry.name)}.geojson`);
    }
    // Parallel-to files
    if (entry.parallel_to && (!entry.osm_relations || entry.osm_relations.length === 0)) {
      featuredCacheFiles.add(`parallel-${slugify(entry.name)}.geojson`);
    }
  }

  if (featuredCacheFiles.size === 0) {
    console.log('[path-geo] No featured paths need elevation enrichment');
  } else {
    // 4. Enrich only featured files that lack elevation
    const toEnrich = [...featuredCacheFiles].filter(file => {
      const filePath = path.join(CACHE_DIR, file);
      if (!fs.existsSync(filePath)) return false;
      const geojson = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return !hasElevation(geojson);
    });

    if (toEnrich.length === 0) {
      console.log(`[path-geo] All ${featuredCacheFiles.size} featured geometry files already have elevation`);
    } else {
      console.log(`[path-geo] Enriching ${toEnrich.length}/${featuredCacheFiles.size} featured files with elevation...`);
      let enriched = 0;

      for (const file of toEnrich) {
        const filePath = path.join(CACHE_DIR, file);
        const geojson = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

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

        await new Promise(r => setTimeout(r, 500));
      }

      console.log(`[path-geo] Elevation enrichment done. Enriched: ${enriched}/${toEnrich.length}`);
    }
  }
}
