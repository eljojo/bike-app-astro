/**
 * Pre-build script: generates public/route-data/{slug}/route-data.json for each route.
 * Follows the same cache-by-hash pattern as scripts/generate-maps.ts.
 *
 * Output per route:
 *   { "polyline": "encoded_string", "center": [lat, lng], "bounds": [[sw_lat, sw_lng], [ne_lat, ne_lng]] }
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseGpx } from '../src/lib/gpx/parse';
import { CITY } from '../src/lib/config/config';
import { CONTENT_DIR } from '../src/lib/config/config.server';

const OUTPUT_DIR = path.resolve('public', 'route-data');
const FORCE = process.argv.includes('--force');

interface RouteDataJson {
  polyline: string;
  center: [number, number];
  bounds: [[number, number], [number, number]];
}

function gpxHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function main() {
  const routesDir = path.join(CONTENT_DIR, CITY, 'routes');
  if (!fs.existsSync(routesDir)) {
    console.log(`[route-data] No routes directory at ${routesDir}, skipping.`);
    return;
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const slugs = fs.readdirSync(routesDir).filter(f =>
    fs.statSync(path.join(routesDir, f)).isDirectory()
  );

  let generated = 0;
  let cached = 0;

  for (const slug of slugs) {
    const slugDir = path.join(routesDir, slug);
    const gpxFile = fs.readdirSync(slugDir).find(f => f.endsWith('.gpx'));
    if (!gpxFile) continue;

    const gpxPath = path.join(slugDir, gpxFile);
    const gpxContent = fs.readFileSync(gpxPath, 'utf-8');
    const hash = gpxHash(gpxContent);

    const outDir = path.join(OUTPUT_DIR, slug);
    const hashFile = path.join(outDir, '.gpx-hash');
    const jsonFile = path.join(outDir, 'route-data.json');

    if (!FORCE && fs.existsSync(jsonFile) && fs.existsSync(hashFile)) {
      const existingHash = fs.readFileSync(hashFile, 'utf-8').trim();
      if (existingHash === hash) {
        cached++;
        continue;
      }
    }

    const track = parseGpx(gpxContent);
    if (track.points.length === 0) continue;

    const lats = track.points.map(p => p.lat);
    const lons = track.points.map(p => p.lon);
    const mid = track.points[Math.floor(track.points.length / 2)];

    const data: RouteDataJson = {
      polyline: track.polyline,
      center: [mid.lat, mid.lon],
      bounds: [
        [Math.min(...lats), Math.min(...lons)],
        [Math.max(...lats), Math.max(...lons)],
      ],
    };

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(jsonFile, JSON.stringify(data));
    fs.writeFileSync(hashFile, hash);
    generated++;
  }

  console.log(`[route-data] Done. Generated: ${generated}, Cached: ${cached}`);
}

main();
