/**
 * Copy cached bike path GeoJSON geometry to public/bike-paths/geo/.
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
const outDir = path.join('public', 'bike-paths', 'geo');

fs.mkdirSync(outDir, { recursive: true });

let copied = 0;

// Copy from geometry cache (populated by cache-path-geometry.ts)
if (fs.existsSync(cacheDir)) {
  const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.geojson'));
  for (const file of files) {
    fs.copyFileSync(path.join(cacheDir, file), path.join(outDir, file));
  }
  copied += files.length;
}

// Demo city: also copy committed test fixtures from e2e/fixtures/overpass/
if (CITY === 'demo') {
  const fixtureDir = path.resolve('e2e', 'fixtures', 'overpass');
  if (fs.existsSync(fixtureDir)) {
    const fixtures = fs.readdirSync(fixtureDir).filter(f => f.endsWith('.geojson'));
    for (const file of fixtures) {
      fs.copyFileSync(path.join(fixtureDir, file), path.join(outDir, file));
    }
    copied += fixtures.length;
  }
}

if (copied > 0) {
  console.log(`[path-geo] Copied ${copied} geometry files to ${outDir}/`);
} else {
  console.log('[path-geo] No geometry files found — skipping');
}
