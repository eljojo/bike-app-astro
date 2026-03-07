// scripts/backfill-photo-coords.ts
//
// One-time script to backfill GPS coordinates on existing photos.
// Fetches each photo from CDN, extracts EXIF GPS, updates media.yml.
//
// Usage: npx tsx scripts/backfill-photo-coords.ts
//
// Requires R2_PUBLIC_URL env var (defaults to https://cdn.ottawabybike.ca)

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { extractGpsCoordinates } from '../src/lib/exif';

const CONTENT_DIR = process.env.CONTENT_DIR || '../bike-routes';
const CDN_URL = process.env.R2_PUBLIC_URL || 'https://cdn.ottawabybike.ca';
const CITY = process.env.CITY || 'ottawa';
const routesDir = path.join(CONTENT_DIR, CITY, 'routes');

interface MediaEntry {
  type: string;
  key: string;
  lat?: number;
  lng?: number;
  [key: string]: unknown;
}

async function main() {
  const routeDirs = fs.readdirSync(routesDir).filter(d =>
    fs.statSync(path.join(routesDir, d)).isDirectory()
  );

  let totalPhotos = 0;
  let withGps = 0;
  let newGps = 0;
  let failed = 0;

  for (const routeSlug of routeDirs) {
    const mediaPath = path.join(routesDir, routeSlug, 'media.yml');
    if (!fs.existsSync(mediaPath)) continue;

    const raw = fs.readFileSync(mediaPath, 'utf-8');
    const media = (yaml.load(raw) as MediaEntry[]) || [];
    let modified = false;

    for (const entry of media) {
      if (entry.type !== 'photo') continue;
      totalPhotos++;

      if (entry.lat != null && entry.lng != null) {
        withGps++;
        continue;
      }

      const url = `${CDN_URL}/${entry.key}`;
      try {
        const res = await fetch(url);
        if (!res.ok) {
          console.error(`  SKIP ${routeSlug}/${entry.key}: HTTP ${res.status}`);
          failed++;
          continue;
        }
        const buffer = await res.arrayBuffer();
        const gps = extractGpsCoordinates(buffer);
        if (gps) {
          entry.lat = gps.lat;
          entry.lng = gps.lng;
          newGps++;
          modified = true;
          console.log(`  GPS  ${routeSlug}/${entry.key}: ${gps.lat}, ${gps.lng}`);
        }
      } catch (err) {
        console.error(`  ERR  ${routeSlug}/${entry.key}: ${err}`);
        failed++;
      }
    }

    if (modified) {
      fs.writeFileSync(mediaPath, yaml.dump(media, { lineWidth: -1, noRefs: true }));
      console.log(`WROTE ${routeSlug}/media.yml`);
    }
  }

  console.log(`\nDone. ${totalPhotos} photos, ${withGps} already had GPS, ${newGps} newly extracted, ${failed} failed.`);
}

main().catch(console.error);
