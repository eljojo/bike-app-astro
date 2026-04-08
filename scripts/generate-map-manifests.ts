/**
 * Generate map image proxy manifests at prebuild time.
 *
 * Reads GPX files for routes/rides/tours and writes JSON manifests containing
 * pre-encoded polylines and content hashes. The proxy reads these at runtime
 * to build Google Static Maps URLs without parsing GPX files.
 *
 * Output files:
 *   public/maps/route-index.json  (wiki instances)
 *   public/maps/ride-index.json   (blog instances)
 *   public/maps/tour-index.json   (blog instances)
 */
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { parseGpx } from '../src/lib/gpx/parse';
import { gpxHash } from '../src/lib/maps/map-generation.server';
import { variantKey } from '../src/lib/gpx/filenames';
import { CITY } from '../src/lib/config/config';
import { CONTENT_DIR } from '../src/lib/config/config.server';
import { findGpxFiles, extractDateFromPath, buildSlug, detectTours } from '../src/loaders/rides';

const OUTPUT_DIR = path.resolve('public', 'maps');

interface RouteIndexEntry {
  hash: string;
  variants: Record<string, { hash: string; polyline: string }>;
}

interface RideIndexEntry {
  hash: string;
  polyline: string;
}

interface TourIndexEntry {
  hash: string;
  rides: string[];
  polylines: string[];
}

function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // --- Routes ---
  const routesDir = path.join(CONTENT_DIR, CITY, 'routes');
  const routeIndex: Record<string, RouteIndexEntry> = {};

  if (fs.existsSync(routesDir)) {
    const slugs = fs.readdirSync(routesDir).filter(f =>
      fs.statSync(path.join(routesDir, f)).isDirectory(),
    );

    for (const slug of slugs) {
      const routeDir = path.join(routesDir, slug);
      const indexPath = path.join(routeDir, 'index.md');
      if (!fs.existsSync(indexPath)) continue;

      const { data: fm } = matter(fs.readFileSync(indexPath, 'utf-8'));
      const variants = fm.variants || [];
      if (variants.length === 0) continue;

      const entry: RouteIndexEntry = { hash: '', variants: {} };

      for (const variant of variants) {
        const vKey = variantKey(variant.gpx);
        const gpxPath = path.join(routeDir, variant.gpx);
        if (!fs.existsSync(gpxPath)) continue;

        const gpxContent = fs.readFileSync(gpxPath, 'utf-8');
        const hash = gpxHash(gpxContent);
        const track = parseGpx(gpxContent);

        if (!track.polyline) continue;

        entry.variants[vKey] = { hash, polyline: track.polyline };
        if (!entry.hash) entry.hash = hash; // first variant = root hash
      }

      if (entry.hash) routeIndex[slug] = entry;
    }
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'route-index.json'), JSON.stringify(routeIndex));
  console.log(`[map-manifests] route-index: ${Object.keys(routeIndex).length} routes`);

  // --- Rides ---
  const ridesDir = path.join(CONTENT_DIR, CITY, 'rides');
  const rideIndex: Record<string, RideIndexEntry> = {};

  if (fs.existsSync(ridesDir)) {
    const gpxPaths = findGpxFiles(ridesDir);
    const tours = detectTours(gpxPaths);
    const tourGpxPaths = new Set(tours.flatMap(t => t.ridePaths));

    for (const gpxRelPath of gpxPaths) {
      const date = extractDateFromPath(gpxRelPath);
      if (!date) continue;

      const gpxFilename = path.basename(gpxRelPath);
      const slug = buildSlug(date, gpxFilename, tourGpxPaths.has(gpxRelPath));
      const gpxContent = fs.readFileSync(path.join(ridesDir, gpxRelPath), 'utf-8');
      const hash = gpxHash(gpxContent);
      const track = parseGpx(gpxContent);

      if (!track.polyline) continue;
      rideIndex[slug] = { hash, polyline: track.polyline };
    }
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'ride-index.json'), JSON.stringify(rideIndex));
  console.log(`[map-manifests] ride-index: ${Object.keys(rideIndex).length} rides`);

  // --- Tours ---
  const tourIndex: Record<string, TourIndexEntry> = {};

  if (fs.existsSync(ridesDir)) {
    const gpxPaths = findGpxFiles(ridesDir);
    const tours = detectTours(gpxPaths);

    for (const tour of tours) {
      const polylines: string[] = [];
      const gpxContents: string[] = [];
      const rideSlugs: string[] = [];

      for (const ridePath of tour.ridePaths) {
        const absPath = path.join(ridesDir, ridePath);
        if (!fs.existsSync(absPath)) continue;
        const content = fs.readFileSync(absPath, 'utf-8');
        gpxContents.push(content);
        const track = parseGpx(content);
        if (track.polyline) polylines.push(track.polyline);

        const date = extractDateFromPath(ridePath);
        if (date) rideSlugs.push(buildSlug(date, path.basename(ridePath), true));
      }

      if (polylines.length === 0) continue;

      const combinedHash = gpxHash(gpxContents.join('\n'));
      tourIndex[tour.slug] = { hash: combinedHash, rides: rideSlugs, polylines };
    }
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'tour-index.json'), JSON.stringify(tourIndex));
  console.log(`[map-manifests] tour-index: ${Object.keys(tourIndex).length} tours`);
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMainModule) main();
export { main as generateMapManifests };
