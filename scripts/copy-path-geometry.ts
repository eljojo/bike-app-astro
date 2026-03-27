/**
 * Copy cached bike path GeoJSON geometry to public/paths/geo/.
 *
 * The cache lives in the data repo at .cache/bikepath-geometry/{city}/.
 * Each file is {relationId}.geojson, fetched from the Overpass API by
 * bike-routes/scripts/cache-bikepath-geometry.mjs.
 *
 * This script runs as part of prebuild — it's a no-op if no cache exists.
 */
import fs from 'node:fs';
import path from 'node:path';

const CITY = process.env.CITY || 'ottawa';
const CONTENT_DIR = process.env.CONTENT_DIR || path.join(process.env.HOME!, 'code', 'bike-routes');
const cacheDir = path.join(CONTENT_DIR, '.cache', 'bikepath-geometry', CITY);
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

for (const file of files) {
  fs.copyFileSync(path.join(cacheDir, file), path.join(outDir, file));
}

console.log(`[path-geo] Copied ${files.length} geometry files to ${outDir}/`);
