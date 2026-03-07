/**
 * Apply photo coordinates from photo_coords.json to media.yml files
 * in a target bike-routes directory.
 *
 * Usage:
 *   npx tsx scripts/apply-coords-to-worktree.ts <coords-json> <target-routes-dir>
 *
 * Example:
 *   npx tsx scripts/apply-coords-to-worktree.ts photo_coords.json ~/code/bike-routes-main-fix/ottawa/routes
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const [coordsFile, routesDir] = process.argv.slice(2);

if (!coordsFile || !routesDir) {
  console.error('Usage: npx tsx scripts/apply-coords-to-worktree.ts <coords-json> <target-routes-dir>');
  process.exit(1);
}

if (!fs.existsSync(coordsFile)) {
  console.error(`Coords file not found: ${coordsFile}`);
  process.exit(1);
}

if (!fs.existsSync(routesDir)) {
  console.error(`Routes dir not found: ${routesDir}`);
  process.exit(1);
}

interface PhotoCoord {
  lat: number;
  lng: number;
  captured_at?: string;
}

const coords: Record<string, PhotoCoord> = JSON.parse(fs.readFileSync(coordsFile, 'utf-8'));
console.log(`Loaded ${Object.keys(coords).length} coordinates from ${coordsFile}`);

const slugs = fs.readdirSync(routesDir).filter(f =>
  fs.statSync(path.join(routesDir, f)).isDirectory()
);

let updatedFiles = 0;
let updatedPhotos = 0;

for (const slug of slugs) {
  const mediaPath = path.join(routesDir, slug, 'media.yml');
  if (!fs.existsSync(mediaPath)) continue;

  const raw = fs.readFileSync(mediaPath, 'utf-8');
  const media = (yaml.load(raw) as Array<Record<string, unknown>>) || [];
  let changed = false;

  for (const entry of media) {
    const key = entry.key as string;
    const coord = coords[key];
    if (!coord) continue;

    if (entry.lat == null && coord.lat != null) {
      entry.lat = coord.lat;
      changed = true;
    }
    if (entry.lng == null && coord.lng != null) {
      entry.lng = coord.lng;
      changed = true;
    }
    if (entry.captured_at == null && coord.captured_at != null) {
      entry.captured_at = coord.captured_at;
      changed = true;
    }

    if (changed) updatedPhotos++;
  }

  if (changed) {
    const output = yaml.dump(media, { flowLevel: -1, lineWidth: -1 });
    fs.writeFileSync(mediaPath, output);
    updatedFiles++;
    console.log(`  Updated ${slug}/media.yml`);
  }
}

console.log(`\nDone: ${updatedPhotos} photos updated across ${updatedFiles} files`);
