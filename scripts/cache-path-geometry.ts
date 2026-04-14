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
import crypto from 'node:crypto';
import { parseBikePathsYml, geoFilesForEntry, type SluggedBikePathYml } from '../src/lib/bike-paths/bikepaths-yml.server';

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

// Use SluggedBikePathYml from the schema — single source of truth.
// Anchors need [lng, lat] tuples for bbox computation.
type CacheEntry = SluggedBikePathYml & { anchors?: Array<[number, number]> };

/**
 * Compute a hash of the inputs that determine a cached geometry file's content.
 * If any of these change, the cached file is stale and must be re-fetched.
 * This is the Nix derivation principle: output = f(inputs).
 */
export function cacheInputHash(entry: CacheEntry): string {
  // Sort keys for deterministic serialization — same inputs always produce same hash
  const inputs: Record<string, unknown> = {};
  for (const key of ['anchors', 'osm_names', 'osm_relations', 'osm_way_ids', 'parallel_to', 'segments', 'slug'] as const) {
    if ((entry as any)[key] != null) inputs[key] = (entry as any)[key];
  }
  return crypto.createHash('sha256').update(JSON.stringify(inputs)).digest('hex').slice(0, 16);
}

/**
 * Check if a cached geometry file is still fresh (inputs haven't changed).
 * Reads the stored input hash from the .hash sidecar file and compares
 * with the current entry's input hash.
 */
function isCacheFresh(entry: CacheEntry, geoPath: string): boolean {
  const hashPath = geoPath + '.hash';
  if (!fs.existsSync(hashPath)) return false; // no hash = legacy cache, treat as stale
  const stored = fs.readFileSync(hashPath, 'utf-8').trim();
  return stored === cacheInputHash(entry);
}

/** Write the input hash sidecar after successfully caching a geometry file. */
function writeCacheHash(entry: CacheEntry, geoPath: string): void {
  fs.writeFileSync(geoPath + '.hash', cacheInputHash(entry));
}

/**
 * Fetch an Overpass query with server rotation and retry.
 * On failure, immediately rotate to the next server rather than retrying the same one.
 * Each server gets up to 2 attempts across the full rotation.
 */
async function queryOverpass(query: string): Promise<any> {
  const PRIMARY = process.env.OVERPASS_URL || OVERPASS_SERVERS[0];
  const fallbacks = OVERPASS_SERVERS.filter(s => s !== PRIMARY);

  // Try primary server first — it has no rate limiting, so XML means bad query
  let res: Response;
  try {
    res = await fetch(PRIMARY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(90_000),
    });

    if (res.ok) {
      const text = await res.text();
      if (text.startsWith('<?xml') || text.startsWith('<html')) {
        // Primary has no rate limiting — XML means the query itself is wrong
        console.log(`  [overpass] bad query (${new URL(PRIMARY).hostname} returned XML):`);
        console.log(`    ${query.replace(/\n/g, '\n    ')}`);
        return null;
      }
      return JSON.parse(text);
    }

    if ([429, 502, 503, 504].includes(res.status)) {
      console.log(`  [overpass] ${new URL(PRIMARY).hostname} returned ${res.status}, trying fallbacks...`);
    } else {
      throw new Error(`Overpass API error ${res.status}: ${await res.text()}`);
    }
  } catch (err: any) {
    if (err instanceof Error && err.message.startsWith('Overpass API error')) throw err;
    console.log(`  [overpass] ${new URL(PRIMARY).hostname} network error: ${err.message}, trying fallbacks...`);
  }

  // Primary is down — try fallback servers with retry
  const MAX_ROUNDS = 2;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    for (const serverUrl of fallbacks) {
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

      if (res!.ok) {
        const text = await res!.text();
        if (text.startsWith('<?xml') || text.startsWith('<html')) {
          console.log(`  [overpass] ${new URL(serverUrl).hostname} returned XML, rotating...`);
          continue;
        }
        return JSON.parse(text);
      }

      if ([429, 502, 503, 504].includes(res!.status)) {
        console.log(`  [overpass] ${new URL(serverUrl).hostname} returned ${res!.status}, rotating...`);
        continue;
      }

      throw new Error(`Overpass API error ${res!.status}: ${await res!.text()}`);
    }

    if (round < MAX_ROUNDS - 1) {
      const wait = (round + 1) * 15;
      console.log(`  [overpass] All fallbacks failed, retrying in ${wait}s...`);
      await new Promise(r => setTimeout(r, wait * 1000));
    }
  }

  throw new Error('Overpass API: all servers failed after retries');
}

export function overpassToGeoJSON(data: any, id: number | string): GeoJSON.FeatureCollection {
  const ways = data.elements.filter((e: any) => e.type === 'way' && e.geometry);
  const features = ways.map((way: any) => ({
    type: 'Feature' as const,
    properties: { wayId: way.id, sourceId: id, surface: way.tags?.surface || '' },
    geometry: {
      type: 'LineString' as const,
      coordinates: way.geometry.map((p: any) => [p.lon, p.lat]),
    },
  }));
  return { type: 'FeatureCollection', features };
}

/** Build the Overpass query for name-based geometry fetching.
 *  Filters by highway tag to exclude park boundary ways (leisure=park). */
export function buildNameQuery(osmNames: string[], bbox: string): string {
  const nameFilters = osmNames.map(n => {
    const escaped = n.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `way["name"="${escaped}"]["highway"~"cycleway|path|footway|track|service|residential|tertiary|secondary|primary"](${bbox});`;
  }).join('\n');
  return `[out:json][timeout:60];\n(\n${nameFilters}\n);\nout geom;`;
}

/** Build Overpass bbox from anchor coordinates: south,west,north,east */
export function anchorBbox(anchors: Array<[number, number]>): string {
  const lngs = anchors.map(a => a[0]);
  const lats = anchors.map(a => a[1]);
  const pad = 0.005; // ~500m padding
  return `${Math.min(...lats) - pad},${Math.min(...lngs) - pad},${Math.max(...lats) + pad},${Math.max(...lngs) + pad}`;
}

// --- Main ---

async function main() {

if (process.env.ENABLE_BIKE_PATHS === 'false') {
  console.log('[path-geo] ENABLE_BIKE_PATHS=false — skipping');
  process.exit(0);
}

const ymlPath = path.join(CONTENT_DIR, CITY, 'bikepaths.yml');

if (!fs.existsSync(ymlPath)) {
  console.log(`[path-geo] No bikepaths.yml at ${ymlPath} — skipping`);
  process.exit(0);
}

const raw = fs.readFileSync(ymlPath, 'utf-8');
const { entries: allEntries } = parseBikePathsYml(raw);
// Normalize anchors to [lng, lat] tuples for bbox computation
const cacheEntries: CacheEntry[] = allEntries.map(e => ({ ...e, anchors: e.anchors?.map(a => 'lat' in a ? [a.lng, a.lat] as [number, number] : a as [number, number]) } as CacheEntry));

// Classify entries by their geo file pattern (single source of truth: geoFilesForEntry)
const relationEntries = cacheEntries.filter(e => geoFilesForEntry(e).some(f => /^\d+\.geojson$/.test(f)));
const wayIdEntries = cacheEntries.filter(e => geoFilesForEntry(e).some(f => f.startsWith('ways-')));
const nameEntries = cacheEntries.filter(e => geoFilesForEntry(e).some(f => f.startsWith('name-')) && e.anchors && e.anchors.length >= 2);
const segmentEntries = cacheEntries.filter(e => geoFilesForEntry(e).some(f => f.startsWith('seg-')));

console.log(`[path-geo] ${relationEntries.length} relations + ${wayIdEntries.length} way-id + ${nameEntries.length} named + ${segmentEntries.length} segmented (${allEntries.length} total)`);

if (!dryRun) fs.mkdirSync(CACHE_DIR, { recursive: true });

// --- Pre-seed cache from e2e fixture files (avoids Overpass for fictional demo IDs) ---
const FIXTURE_DIR = path.resolve('e2e', 'fixtures', 'overpass');
if (!dryRun && fs.existsSync(FIXTURE_DIR)) {
  let seeded = 0;
  for (const entry of cacheEntries) {
    for (const file of geoFilesForEntry(entry)) {
      const fixturePath = path.join(FIXTURE_DIR, file);
      const cachePath = path.join(CACHE_DIR, file);
      if (!fs.existsSync(fixturePath)) continue;
      const needsGeo = !fs.existsSync(cachePath) || forceRefresh;
      const needsHash = !isCacheFresh(entry, cachePath);
      if (needsGeo || needsHash) {
        if (needsGeo) fs.copyFileSync(fixturePath, cachePath);
        writeCacheHash(entry, cachePath);
        seeded++;
      }
    }
  }
  if (seeded > 0) console.log(`[path-geo] Pre-seeded ${seeded} geometry files from e2e fixtures`);
}

let fetched = 0;
let skipped = 0;

// --- Pass 1: Relation-based entries ---
// Relation IDs are stable keys — the file is keyed by relation ID, not slug.
// Still hash-check in case the entry's relation list changed.
for (const entry of relationEntries) {
  for (const relId of entry.osm_relations ?? []) {
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
      if (!data) continue;
      const geojson = overpassToGeoJSON(data, relId);
      fs.writeFileSync(outPath, JSON.stringify(geojson));
      fetched++;
    } catch (err: any) {
      console.error(`  Error: ${err.message}`);
    }
  }
}

// --- Pass 1b: Way-ID-based entries (pipeline provenance) ---
if (wayIdEntries.length > 0) {
  console.log(`\nPass 1b: Fetching geometry for ${wayIdEntries.length} way-ID entries...`);

  for (const entry of wayIdEntries) {
    const outPath = path.join(CACHE_DIR, geoFilesForEntry(entry)[0]);

    if (fs.existsSync(outPath) && !forceRefresh) {
      if (isCacheFresh(entry, outPath)) {
        skipped++;
        continue;
      }
      console.log(`  [stale] ${entry.slug}: inputs changed — re-fetching`);
    }

    if (dryRun) {
      console.log(`  Would fetch ${entry.osm_way_ids!.length} ways (${entry.name})`);
      continue;
    }

    console.log(`  Fetching ${entry.osm_way_ids!.length} ways by ID (${entry.name})...`);
    try {
      const wayIds = entry.osm_way_ids!;
      const query = `[out:json][timeout:60];\n(\n${wayIds.map(id => `way(${id});`).join('\n')}\n);\nout geom;`;
      const data = await queryOverpass(query);
      if (!data) continue;
      const geojson = overpassToGeoJSON(data, entry.slug);
      if (geojson.features.length > 0) {
        fs.writeFileSync(outPath, JSON.stringify(geojson));
        writeCacheHash(entry, outPath);
        fetched++;
      } else {
        console.log(`  No ways found for ${entry.name}`);
      }
    } catch (err: any) {
      console.error(`  Error: ${err.message}`);
    }
  }
}

// --- Pass 2: Name-based entries (query ways by name within anchor bbox) ---
for (const entry of nameEntries) {
  const outPath = path.join(CACHE_DIR, geoFilesForEntry(entry)[0]);

  if (fs.existsSync(outPath) && !forceRefresh) {
    if (isCacheFresh(entry, outPath)) {
      skipped++;
      continue;
    }
    console.log(`  [stale] ${entry.slug}: inputs changed since last fetch — re-fetching`);
  }

  if (dryRun) {
    console.log(`  Would fetch by name: ${entry.osm_names![0]} (${entry.name})`);
    continue;
  }

  console.log(`  Fetching by name: ${entry.osm_names![0]} (${entry.name})...`);
  try {
    const bbox = anchorBbox(entry.anchors!);
    const query = buildNameQuery(entry.osm_names!, bbox);
    const data = await queryOverpass(query);
    if (!data) continue;
    const geojson = overpassToGeoJSON(data, entry.slug);
    if (geojson.features.length > 0) {
      fs.writeFileSync(outPath, JSON.stringify(geojson));
      writeCacheHash(entry, outPath);
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
  const outPath = path.join(CACHE_DIR, geoFilesForEntry(entry)[0]);

  if (fs.existsSync(outPath) && !forceRefresh) {
    if (isCacheFresh(entry, outPath)) {
      skipped++;
      continue;
    }
    console.log(`  [stale] ${entry.slug}: inputs changed — re-fetching`);
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
    if (!data) continue;
    const geojson = overpassToGeoJSON(data, entry.slug);
    if (geojson.features.length > 0) {
      fs.writeFileSync(outPath, JSON.stringify(geojson));
      writeCacheHash(entry, outPath);
      fetched++;
    } else {
      console.log(`  No ways found for ${entry.name}`);
    }
  } catch (err: any) {
    console.error(`  Error: ${err.message}`);
  }
}

// --- Pass 4: Parallel-to entries — unnamed cycleways alongside named roads ---
const parallelEntries = cacheEntries.filter(
  e => geoFilesForEntry(e).some(f => f.startsWith('parallel-')),
);

if (parallelEntries.length > 0) {
  console.log(`\nPass 4: Fetching geometry for ${parallelEntries.length} parallel-to entries...`);

  for (const entry of parallelEntries) {
    const outFile = path.join(CACHE_DIR, geoFilesForEntry(entry)[0]);

    if (!forceRefresh && fs.existsSync(outFile)) {
      if (isCacheFresh(entry, outFile)) {
        skipped++;
        continue;
      }
      console.log(`  [stale] ${entry.slug}: inputs changed — re-fetching`);
    }

    if (!entry.anchors || entry.anchors.length < 2) {
      console.log(`  [skip] ${entry.name} — no anchors for bbox`);
      continue;
    }

    const bbox = anchorBbox(entry.anchors as Array<[number, number]>);
    const roadName = entry.parallel_to!.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    const q = `[out:json][timeout:60];
way["name"="${roadName}"](${bbox}) -> .road;
way["highway"="cycleway"][!"name"](around.road:30);
(._;>;);
out geom;`;

    if (dryRun) {
      console.log(`  [dry-run] parallel-${entry.slug}: ${entry.parallel_to}`);
      continue;
    }

    try {
      const data = await queryOverpass(q);
      if (!data) continue;
      const geojson = overpassToGeoJSON(data, `parallel-${entry.slug}`);
      if (geojson.features.length === 0) {
        console.log(`  [empty] parallel-${entry.slug}: no geometry found`);
        continue;
      }

      fs.writeFileSync(outFile, JSON.stringify(geojson));
      writeCacheHash(entry, outFile);
      fetched++;
      console.log(`  parallel-${entry.slug}: ${geojson.features.length} features`);
    } catch (err: any) {
      console.error(`  [error] parallel-${entry.slug}: ${err.message}`);
    }
  }
}

console.log(`[path-geo] Done. Fetched: ${fetched}, Cached: ${skipped}`);

// --- Write manifest: the authoritative list of geo files for this build ---
// generate-path-tiles reads this instead of globbing the cache directory,
// preventing stale/orphaned files from poisoning the tile build.
// Each file records its input hash — the derivation key that produced it.
if (!dryRun) {
  const fileEntries: Record<string, string> = {};
  for (const entry of cacheEntries) {
    for (const file of geoFilesForEntry(entry)) {
      fileEntries[file] = cacheInputHash(entry);
    }
  }
  const manifest = {
    city: CITY,
    generated: new Date().toISOString(),
    files: Object.keys(fileEntries).sort(),
    hashes: fileEntries,
  };
  fs.writeFileSync(path.join(CACHE_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[path-geo] Wrote manifest with ${manifest.files.length} expected geo files`);
}

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

  // 1. Use the already-parsed entries with canonical disambiguated slugs
  const ymlBySlug = new Map(allEntries.map(e => [e.slug, e]));

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

  // 3. Collect cache filenames for featured entries (using shared geoFilesForEntry)
  const featuredCacheFiles = new Set<string>();
  for (const ymlSlug of featuredYmlSlugs) {
    const entry = ymlBySlug.get(ymlSlug);
    if (!entry) continue;
    for (const file of geoFilesForEntry(entry)) {
      featuredCacheFiles.add(file);
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

}

const _isDirectRun = process.argv[1]?.endsWith('cache-path-geometry.ts');
if (_isDirectRun) main();
