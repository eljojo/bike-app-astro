/**
 * Fetch and cache bike path geometry from the Overpass API.
 *
 * Uses the app-wide content-addressed Overpass cache (.cache/overpass/)
 * which keys raw responses by query hash. Processing (overpassToGeoJSON) always re-runs
 * from cached raw data — changing what we extract never requires re-fetching.
 *
 * Reads bikepaths.yml from CONTENT_DIR/{CITY}/, fetches OSM relation
 * geometry for each entry, and writes processed GeoJSON to .cache/bikepath-geometry/{city}/.
 *
 * Usage:
 *   npx tsx scripts/cache-path-geometry.ts
 *   npx tsx scripts/cache-path-geometry.ts --dry-run
 *
 * Env: CONTENT_DIR (default: ~/code/bike-routes), CITY (default: ottawa)
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseBikePathsYml, geoFilesForEntry, type SluggedBikePathYml } from '../src/lib/bike-paths/bikepaths-yml.server';
import { queryOverpass } from './pipeline/lib/overpass.ts';
import { haversineKm } from '../src/lib/geo/proximity';

const CITY = process.env.CITY || 'ottawa';
const CONTENT_DIR = process.env.CONTENT_DIR || path.join(process.env.HOME!, 'code', 'bike-routes');
const CACHE_DIR = path.resolve('.cache', 'bikepath-geometry', CITY);
const dryRun = process.argv.includes('--dry-run');

// Use SluggedBikePathYml from the schema — single source of truth.
// Anchors need [lng, lat] tuples for bbox computation.
type CacheEntry = SluggedBikePathYml & { anchors?: Array<[number, number]> };

export function overpassToGeoJSON(data: any, id: number | string): GeoJSON.FeatureCollection {
  const ways = data.elements.filter((e: any) => e.type === 'way' && e.geometry);
  const features = ways.map((way: any) => ({
    type: 'Feature' as const,
    properties: { wayId: way.id, sourceId: id, surface: way.tags?.surface || '', name: way.tags?.name || '' },
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

/**
 * Verify that the fetched geometry for an entry actually lives near its
 * YML anchors. Defense-in-depth against cache poisoning: if a geojson file
 * somehow contains ways from a different region (stale write, mismatched
 * filename, hash check escape), this is how we notice.
 *
 * The check: compute the centroid of all feature coordinates, clamp it to
 * the anchor bbox (point-to-rectangle distance), and haversine-measure.
 * If the centroid is inside the bbox the distance is 0 — this keeps the
 * check honest for long-distance trails where anchors span the route.
 * Threshold defaults to 10km, which is loose enough to absorb normal
 * bbox-crossing ways and strict enough to catch "wrong city" poisoning.
 *
 * Returns {ok: true} when there are no anchors or no features to compare
 * — a pure data-state check, it cannot fail on absence.
 */
export type AnchorLike = [number, number] | { lat: number; lng: number };

export function verifyGeometryMatchesAnchors(
  entry: { slug: string; name?: string; anchors?: AnchorLike[] },
  features: Array<{ geometry?: { coordinates?: unknown } }>,
  thresholdKm = 10,
): { ok: true } | { ok: false; distanceKm: number; centroid: [number, number] } {
  const anchors = entry.anchors ?? [];
  if (anchors.length === 0) return { ok: true };

  const anchorCoords: Array<[number, number]> = anchors.map(a =>
    Array.isArray(a) ? [a[0], a[1]] : [a.lng, a.lat],
  );
  const minLng = Math.min(...anchorCoords.map(c => c[0]));
  const maxLng = Math.max(...anchorCoords.map(c => c[0]));
  const minLat = Math.min(...anchorCoords.map(c => c[1]));
  const maxLat = Math.max(...anchorCoords.map(c => c[1]));

  let sumLng = 0, sumLat = 0, n = 0;
  for (const feature of features) {
    const coords = feature.geometry?.coordinates;
    if (!Array.isArray(coords)) continue;
    for (const pt of coords) {
      if (!Array.isArray(pt) || pt.length < 2) continue;
      const [lng, lat] = pt as [number, number];
      if (typeof lng !== 'number' || typeof lat !== 'number') continue;
      sumLng += lng;
      sumLat += lat;
      n++;
    }
  }
  if (n === 0) return { ok: true };

  const centroid: [number, number] = [sumLng / n, sumLat / n];

  // Clamp the centroid to the anchor bbox — distance from a point inside is 0.
  const clampedLng = Math.min(Math.max(centroid[0], minLng), maxLng);
  const clampedLat = Math.min(Math.max(centroid[1], minLat), maxLat);
  const distanceKm = haversineKm(centroid[1], centroid[0], clampedLat, clampedLng);

  if (distanceKm > thresholdKm) {
    return { ok: false, distanceKm, centroid };
  }
  return { ok: true };
}

/**
 * Remove cached .geojson files that are not in the active set.
 *
 * The manifest tells the reader which files are authoritative, but the
 * cache dir still accumulates orphans every time an entry's slug or
 * discovery mechanism changes (e.g. `name-foo.geojson` -> `ways-foo.geojson`
 * when osm_way_ids are added). Orphans are invisible to the tile build
 * but surface as ghost test failures and bloat the working tree — so we
 * delete them alongside their .hash sidecars whenever the manifest is
 * refreshed.
 *
 * Non-geojson files (manifest.json, README, etc.) are left alone.
 */
export function cleanupOrphanedCacheFiles(
  cacheDir: string,
  activeFiles: Set<string>,
): { removed: string[] } {
  const removed: string[] = [];
  if (!fs.existsSync(cacheDir)) return { removed };

  for (const file of fs.readdirSync(cacheDir)) {
    if (!file.endsWith('.geojson')) continue;
    if (activeFiles.has(file)) continue;

    fs.rmSync(path.join(cacheDir, file));
    removed.push(file);

    const hashSidecar = path.join(cacheDir, `${file}.hash`);
    if (fs.existsSync(hashSidecar)) fs.rmSync(hashSidecar);
  }

  return { removed };
}

/** Fetch raw Overpass data and process into GeoJSON. The pipeline cache handles
 *  dedup — same query string = cache hit, no network request. */
async function fetchAndProcess(query: string, id: number | string, outPath: string): Promise<boolean> {
  try {
    const data = await queryOverpass(query);
    if (!data) return false;
    const geojson = overpassToGeoJSON(data, id);
    if (geojson.features.length === 0) return false;
    fs.writeFileSync(outPath, JSON.stringify(geojson));
    return true;
  } catch (err: any) {
    console.error(`  Error: ${err.message}`);
    return false;
  }
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
const fixturedFiles = new Set<string>();
if (!dryRun && fs.existsSync(FIXTURE_DIR)) {
  for (const entry of cacheEntries) {
    for (const file of geoFilesForEntry(entry)) {
      const fixturePath = path.join(FIXTURE_DIR, file);
      if (!fs.existsSync(fixturePath)) continue;
      fs.copyFileSync(fixturePath, path.join(CACHE_DIR, file));
      fixturedFiles.add(file);
    }
  }
  if (fixturedFiles.size > 0) console.log(`[path-geo] Pre-seeded ${fixturedFiles.size} geometry files from e2e fixtures`);
}

let processed = 0;

// --- Pass 1: Relation-based entries ---
for (const entry of relationEntries) {
  for (const relId of entry.osm_relations ?? []) {
    const file = `${relId}.geojson`;
    if (fixturedFiles.has(file)) continue;
    const outPath = path.join(CACHE_DIR, file);

    if (dryRun) {
      console.log(`  Would fetch: relation ${relId} (${entry.name})`);
      continue;
    }

    const query = `[out:json][timeout:60];relation(${relId});(._;>;);out geom;`;
    if (await fetchAndProcess(query, relId, outPath)) processed++;
  }
}

// --- Pass 1b: Way-ID-based entries (pipeline provenance) ---
if (wayIdEntries.length > 0) {
  for (const entry of wayIdEntries) {
    const file = geoFilesForEntry(entry)[0];
    if (fixturedFiles.has(file)) continue;
    const outPath = path.join(CACHE_DIR, file);

    if (dryRun) {
      console.log(`  Would fetch ${entry.osm_way_ids!.length} ways (${entry.name})`);
      continue;
    }

    const wayIds = entry.osm_way_ids!;
    const query = `[out:json][timeout:60];\n(\n${wayIds.map(id => `way(${id});`).join('\n')}\n);\nout geom;`;
    if (await fetchAndProcess(query, entry.slug, outPath)) processed++;
  }
}

// --- Pass 2: Name-based entries (query ways by name within anchor bbox) ---
for (const entry of nameEntries) {
  const file = geoFilesForEntry(entry)[0];
  if (fixturedFiles.has(file)) continue;
  const outPath = path.join(CACHE_DIR, file);

  if (dryRun) {
    console.log(`  Would fetch by name: ${entry.osm_names![0]} (${entry.name})`);
    continue;
  }

  const bbox = anchorBbox(entry.anchors!);
  const query = buildNameQuery(entry.osm_names!, bbox);
  if (await fetchAndProcess(query, entry.slug, outPath)) processed++;
}

// --- Pass 3: Segment-based entries (query individual ways by ID) ---
for (const entry of segmentEntries) {
  const file = geoFilesForEntry(entry)[0];
  if (fixturedFiles.has(file)) continue;
  const outPath = path.join(CACHE_DIR, file);

  if (dryRun) {
    console.log(`  Would fetch segments: ${entry.segments!.length} ways (${entry.name})`);
    continue;
  }

  const wayIds = entry.segments!.map(s => s.osm_way);
  const query = `[out:json][timeout:60];\n(\n${wayIds.map(id => `way(${id});`).join('\n')}\n);\nout geom;`;
  if (await fetchAndProcess(query, entry.slug, outPath)) processed++;
}

// --- Pass 4: Parallel-to entries — unnamed cycleways alongside named roads ---
const parallelEntries = cacheEntries.filter(
  e => geoFilesForEntry(e).some(f => f.startsWith('parallel-')),
);

if (parallelEntries.length > 0) {
  for (const entry of parallelEntries) {
    const file = geoFilesForEntry(entry)[0];
    if (fixturedFiles.has(file)) continue;
    const outPath = path.join(CACHE_DIR, file);

    if (!entry.anchors || entry.anchors.length < 2) {
      console.log(`  [skip] ${entry.name} — no anchors for bbox`);
      continue;
    }

    if (dryRun) {
      console.log(`  [dry-run] parallel-${entry.slug}: ${entry.parallel_to}`);
      continue;
    }

    const bbox = anchorBbox(entry.anchors as Array<[number, number]>);
    const roadName = entry.parallel_to!.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const query = `[out:json][timeout:60];
way["name"="${roadName}"](${bbox}) -> .road;
way["highway"="cycleway"][!"name"](around.road:30);
(._;>;);
out geom;`;

    if (await fetchAndProcess(query, `parallel-${entry.slug}`, outPath)) processed++;
  }
}

console.log(`[path-geo] Done. Processed: ${processed}, Fixtured: ${fixturedFiles.size}`);

// --- Verification pass: for entries whose Overpass query was bbox-filtered
//     (name- and parallel- passes), the fetched geometry's centroid must
//     live near the entry's anchor bbox. Defense-in-depth against cache
//     poisoning: a hash match doesn't prove the cached ways are the RIGHT
//     ways, and a stale file from a prior YML revision can otherwise leak
//     through. Runs on every active file — fresh writes and cache hits
//     alike — so any regression fails the build loud and immediate.
//
//     Relation- and way-ID-based queries are NOT bbox-filtered: relation
//     members can legitimately span a whole province (Route Verte, Sentier
//     Trans-Canada), and explicitly-listed way_ids can live anywhere. The
//     anchor check would produce false positives on those.
if (!dryRun) {
  type Violation = { slug: string; name?: string; file: string; distanceKm: number; centroid: [number, number] };
  const violations: Violation[] = [];

  for (const entry of cacheEntries) {
    if (!entry.anchors || entry.anchors.length === 0) continue;
    for (const file of geoFilesForEntry(entry)) {
      const isBboxFiltered = file.startsWith('name-') || file.startsWith('parallel-');
      if (!isBboxFiltered) continue;
      const filePath = path.join(CACHE_DIR, file);
      if (!fs.existsSync(filePath)) continue;
      let geojson: { features?: Array<{ geometry?: { coordinates?: unknown } }> };
      try {
        geojson = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } catch {
        continue;
      }
      const result = verifyGeometryMatchesAnchors(entry, geojson.features ?? []);
      if (!result.ok) {
        violations.push({ slug: entry.slug, name: entry.name, file, distanceKm: result.distanceKm, centroid: result.centroid });
      }
    }
  }

  if (violations.length > 0) {
    console.error(`[path-geo] ✗ ${violations.length} cached file(s) have geometry far from their YML anchors:`);
    for (const v of violations.slice(0, 20)) {
      console.error(`    ${v.file} (${v.slug} — ${v.name ?? ''}): centroid ${v.centroid[1].toFixed(4)},${v.centroid[0].toFixed(4)} is ${v.distanceKm.toFixed(1)}km from the anchor bbox`);
    }
    if (violations.length > 20) console.error(`    ... and ${violations.length - 20} more`);
    console.error(`[path-geo] Fix the data (re-run to refetch from Overpass, or correct the entry's anchors) and try again.`);
    process.exit(1);
  }
}

// --- Write manifest: the authoritative list of geo files for this build ---
// generate-path-tiles reads this instead of globbing the cache directory,
// preventing stale/orphaned files from poisoning the tile build.
if (!dryRun) {
  const files: string[] = [];
  for (const entry of cacheEntries) {
    for (const file of geoFilesForEntry(entry)) {
      files.push(file);
    }
  }
  const activeFiles = new Set(files);
  const manifest = {
    city: CITY,
    generated: new Date().toISOString(),
    files: [...activeFiles].sort(),
  };
  fs.writeFileSync(path.join(CACHE_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[path-geo] Wrote manifest with ${manifest.files.length} expected geo files`);

  // Delete orphans that accumulated from prior YML revisions so the cache
  // dir stays in sync with the manifest. Prevents stale name-foo.geojson
  // from lingering after an entry gains osm_way_ids, etc.
  const { removed } = cleanupOrphanedCacheFiles(CACHE_DIR, activeFiles);
  if (removed.length > 0) {
    console.log(`[path-geo] Cleaned ${removed.length} orphaned geo file(s)`);
  }
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
