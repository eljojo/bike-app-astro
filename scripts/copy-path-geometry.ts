/**
 * Copy cached bike path GeoJSON geometry to public/paths/geo/.
 *
 * The cache lives at .cache/bikepath-geometry/{city}/ in the astro repo,
 * populated by scripts/cache-path-geometry.ts (Overpass API fetch).
 *
 * This script runs as part of prebuild. No network calls.
 */
import fs from 'node:fs';
import path from 'node:path';

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

for (const file of files) {
  fs.copyFileSync(path.join(cacheDir, file), path.join(outDir, file));
}

console.log(`[path-geo] Copied ${files.length} geometry files to ${outDir}/`);
