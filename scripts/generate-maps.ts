import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import sharp from 'sharp';
import { parseGpx } from '../src/lib/gpx/parse';
import {
  mapThumbPaths, buildStaticMapUrl, buildStaticMapUrlMulti, buildStaticMapUrlFromSegments,
  gpxHash, hashPath,
  needsRegeneration,
} from '../src/lib/maps/map-generation.server';
import { variantKey } from '../src/lib/gpx/filenames';
import { mergeAdjacentSegments } from '../src/lib/geo/merge-segments';
import { getCityConfig } from '../src/lib/config/city-config';
import { CITY } from '../src/lib/config/config';
import { CONTENT_DIR } from '../src/lib/config/config.server';
import { findGpxFiles, extractDateFromPath, buildSlug, detectTours } from '../src/loaders/rides';
import crypto from 'node:crypto';
const API_KEY = process.env.GOOGLE_MAPS_STATIC_API_KEY;
const FORCE = process.argv.includes('--force');


if (!API_KEY || API_KEY === 'your-key-here') {
  console.warn('[maps] GOOGLE_MAPS_STATIC_API_KEY not set — skipping map generation');
  process.exit(0);
}

/** Extract short language code: 'en-CA' → 'en' */
function shortLang(locale: string): string {
  return locale.split('-')[0];
}

async function generateMapImages(pngBuffer: Buffer, paths: ReturnType<typeof mapThumbPaths>, aspect: '1:1' | '2:1' = '1:1') {
  fs.mkdirSync(path.dirname(paths.thumb), { recursive: true });

  fs.writeFileSync(paths.full, pngBuffer);

  const is2to1 = aspect === '2:1';
  await sharp(pngBuffer)
    .resize(1500, is2to1 ? 750 : 1500, { fit: 'cover' })
    .webp({ quality: 80 })
    .toFile(paths.thumbLarge);

  await sharp(pngBuffer)
    .resize(750, is2to1 ? 375 : 750, { fit: 'cover' })
    .webp({ quality: 80 })
    .toFile(paths.thumb);

  await sharp(pngBuffer)
    .resize(375, is2to1 ? 188 : 375, { fit: 'cover' })
    .webp({ quality: 80 })
    .toFile(paths.thumbSmall);

  await sharp(pngBuffer)
    .resize(1200, 628, { fit: 'cover' })
    .jpeg({ quality: 85 })
    .toFile(paths.social);
}

async function main() {
  const config = getCityConfig();
  const defaultLang = shortLang(config.locale);
  const languages = [defaultLang];

  let generated = 0;
  let skipped = 0;

  // --- Routes (wiki instances): directory-based with index.md + variants ---
  const routesDir = path.join(CONTENT_DIR, CITY, 'routes');
  if (fs.existsSync(routesDir)) {
    const slugs = fs.readdirSync(routesDir).filter(f =>
      fs.statSync(path.join(routesDir, f)).isDirectory()
    );

    for (const slug of slugs) {
      const routeDir = path.join(routesDir, slug);
      const indexPath = path.join(routeDir, 'index.md');
      if (!fs.existsSync(indexPath)) continue;

      const { data: fm } = matter(fs.readFileSync(indexPath, 'utf-8'));
      const variants = fm.variants || [];
      if (variants.length === 0) continue;

      for (let i = 0; i < variants.length; i++) {
        const variant = variants[i];
        const vKey = variantKey(variant.gpx);
        const gpxPath = path.join(routeDir, variant.gpx);

        if (!fs.existsSync(gpxPath)) {
          console.log(`[maps] ${slug}/${vKey}: no GPX, skipping`);
          continue;
        }

        const gpxContent = fs.readFileSync(gpxPath, 'utf-8');
        const hash = gpxHash(gpxContent);
        const variantCacheKey = vKey;

        for (const lang of languages) {
          const langPrefix = lang === defaultLang ? undefined : lang;
          const cacheKey = slug + '/' + variantCacheKey;

          if (!FORCE && !needsRegeneration(cacheKey, hash, langPrefix)) {
            skipped++;
            continue;
          }

          const label = langPrefix ? `${slug}/${vKey} [${lang}]` : `${slug}/${vKey}`;
          console.log(`[maps] ${label}: generating...`);

          const track = parseGpx(gpxContent);
          if (!track.polyline) {
            console.log(`[maps] ${label}: empty polyline, skipping`);
            continue;
          }

          const url = buildStaticMapUrl(track.polyline, API_KEY!, lang);
          const response = await fetch(url);
          if (!response.ok) {
            console.error(`[maps] ${label}: HTTP ${response.status}`);
            continue;
          }
          const pngBuffer = Buffer.from(await response.arrayBuffer());

          const variantPaths = mapThumbPaths(slug, variantCacheKey, langPrefix);
          await generateMapImages(pngBuffer, variantPaths);
          fs.writeFileSync(hashPath(cacheKey, langPrefix), hash);

          // First variant also goes to the route-level cache (used by route cards)
          if (i === 0) {
            const routePaths = mapThumbPaths(slug, undefined, langPrefix);
            await generateMapImages(pngBuffer, routePaths);
            fs.writeFileSync(hashPath(slug, langPrefix), hash);
          }

          generated++;
        }
      }
    }
  }

  // --- Rides (blog instances): flat GPX files under rides/ ---
  const ridesDir = path.join(CONTENT_DIR, CITY, 'rides');
  if (fs.existsSync(ridesDir)) {
    const gpxPaths = findGpxFiles(ridesDir);
    const tours = detectTours(gpxPaths);
    const tourGpxPaths = new Set(tours.flatMap(t => t.ridePaths));

    for (const gpxRelPath of gpxPaths) {
      const date = extractDateFromPath(gpxRelPath);
      if (!date) continue;

      const gpxFilename = path.basename(gpxRelPath);
      const gpxAbsPath = path.join(ridesDir, gpxRelPath);

      const slug = buildSlug(date, gpxFilename, tourGpxPaths.has(gpxRelPath));
      const gpxContent = fs.readFileSync(gpxAbsPath, 'utf-8');
      const hash = gpxHash(gpxContent);

      for (const lang of languages) {
        const langPrefix = lang === defaultLang ? undefined : lang;

        if (!FORCE && !needsRegeneration(slug, hash, langPrefix)) {
          skipped++;
          continue;
        }

        const label = langPrefix ? `${slug} [${lang}]` : slug;
        console.log(`[maps] ${label}: generating...`);

        const track = parseGpx(gpxContent);
        if (!track.polyline) {
          console.log(`[maps] ${label}: empty polyline, skipping`);
          continue;
        }

        const url = buildStaticMapUrl(track.polyline, API_KEY!, lang);
        const response = await fetch(url);
        if (!response.ok) {
          console.error(`[maps] ${label}: HTTP ${response.status}`);
          continue;
        }
        const pngBuffer = Buffer.from(await response.arrayBuffer());

        const ridePaths = mapThumbPaths(slug, undefined, langPrefix);
        await generateMapImages(pngBuffer, ridePaths);
        fs.writeFileSync(hashPath(slug, langPrefix), hash);

        generated++;
      }
    }
  }

  // --- Tours (blog instances): combined map of all rides in each tour ---
  if (fs.existsSync(ridesDir)) {
    const gpxPaths = findGpxFiles(ridesDir);
    const tours = detectTours(gpxPaths);

    for (const tour of tours) {
      const polylines: string[] = [];
      const gpxContents: string[] = [];
      for (const ridePath of tour.ridePaths) {
        const absPath = path.join(ridesDir, ridePath);
        if (!fs.existsSync(absPath)) continue;
        const content = fs.readFileSync(absPath, 'utf-8');
        gpxContents.push(content);
        const track = parseGpx(content);
        if (track.polyline) polylines.push(track.polyline);
      }
      if (polylines.length === 0) continue;

      // Hash all GPX files in the tour for cache invalidation
      const combinedHash = crypto.createHash('sha256')
        .update(gpxContents.join('\n'))
        .digest('hex').slice(0, 16);
      const tourSlug = `tour-${tour.slug}`;

      for (const lang of languages) {
        const langPrefix = lang === defaultLang ? undefined : lang;

        if (!FORCE && !needsRegeneration(tourSlug, combinedHash, langPrefix)) {
          skipped++;
          continue;
        }

        const label = langPrefix ? `${tourSlug} [${lang}]` : tourSlug;
        console.log(`[maps] ${label}: generating tour map (${polylines.length} rides)...`);

        const url = buildStaticMapUrlMulti(polylines, API_KEY!, lang);
        if (!url) continue;
        const response = await fetch(url);
        if (!response.ok) {
          console.error(`[maps] ${label}: HTTP ${response.status}`);
          continue;
        }
        const pngBuffer = Buffer.from(await response.arrayBuffer());

        const tourPaths = mapThumbPaths(tourSlug, undefined, langPrefix);
        await generateMapImages(pngBuffer, tourPaths);
        fs.writeFileSync(hashPath(tourSlug, langPrefix), combinedHash);

        generated++;
      }
    }
  }

  // --- Bike Paths: generate thumbnails from cached GeoJSON geometry ---
  const geoDir = path.join('public', 'bike-paths', 'geo');
  if (process.env.ENABLE_BIKE_PATHS !== 'false' && fs.existsSync(geoDir)) {
    const { loadBikePathEntries } = await import('../src/lib/bike-paths/bike-path-entries.server');
    const { pages } = loadBikePathEntries();

    for (const page of pages) {
      if (page.geoFiles.length === 0) continue;

      // Collect segments from GeoJSON files — one per feature to avoid
      // drawing straight lines between disconnected path sections
      const segments: [number, number][][] = [];
      const geoContents: string[] = [];
      for (const geoFile of page.geoFiles) {
        const geoPath = path.join(geoDir, geoFile);
        if (!fs.existsSync(geoPath)) continue;
        const content = fs.readFileSync(geoPath, 'utf-8');
        geoContents.push(content);
        const geojson = JSON.parse(content);
        for (const feature of geojson.features ?? []) {
          if (feature.geometry?.type === 'LineString') {
            const coords: [number, number][] = feature.geometry.coordinates.map(
              (c: number[]) => [c[1], c[0]] as [number, number],
            );
            if (coords.length >= 2) segments.push(coords);
          } else if (feature.geometry?.type === 'MultiLineString') {
            for (const line of feature.geometry.coordinates) {
              const coords: [number, number][] = line.map(
                (c: number[]) => [c[1], c[0]] as [number, number],
              );
              if (coords.length >= 2) segments.push(coords);
            }
          }
        }
      }

      if (segments.length === 0) continue;

      const combinedHash = crypto.createHash('sha256')
        .update(geoContents.join('\n'))
        .digest('hex').slice(0, 16);
      const mapSlug = `path-${page.slug}`;

      // Bike paths: single thumbnail in default locale only (no localized variants).
      // The map is just geometry on tiles — locale doesn't change the content.
      // Routes and rides keep per-locale generation.
      for (const lang of [defaultLang]) {
        const langPrefix = lang === defaultLang ? undefined : lang;

        if (!FORCE && !needsRegeneration(mapSlug, combinedHash, langPrefix)) {
          skipped++;
          continue;
        }

        const label = langPrefix ? `${mapSlug} [${lang}]` : mapSlug;
        console.log(`[maps] ${label}: generating bike path map...`);

        // Merge adjacent segments that share endpoints (within 100m) into
        // continuous chains, then pass directly to the URL builder. This avoids
        // the encode→decode→re-split round-trip that dropped small park paths.
        const merged = mergeAdjacentSegments(segments, 0.1);
        const url = buildStaticMapUrlFromSegments(merged, API_KEY!, lang, { size: '800x400', markers: false });
        if (!url) {
          console.warn(`[maps] WARNING: ${label} — no renderable geometry, skipping`);
          continue;
        }
        const response = await fetch(url);
        if (!response.ok) {
          console.error(`[maps] ${label}: HTTP ${response.status}`);
          continue;
        }
        const pngBuffer = Buffer.from(await response.arrayBuffer());

        const thumbPaths = mapThumbPaths(mapSlug, undefined, langPrefix);
        await generateMapImages(pngBuffer, thumbPaths, '2:1');
        fs.writeFileSync(hashPath(mapSlug, langPrefix), combinedHash);

        generated++;
      }
    }
  }

  if (generated === 0 && skipped === 0) {
    console.log('[maps] No routes or rides found — nothing to generate');
  } else {
    console.log(`[maps] Done. Generated: ${generated}, Cached: ${skipped}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
