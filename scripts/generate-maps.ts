import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import sharp from 'sharp';
import { parseGpx } from '../src/lib/gpx/parse';
import {
  mapThumbPaths, buildStaticMapUrl, buildStaticMapUrlMulti,
  gpxHash, hashPath,
  needsRegeneration,
} from '../src/lib/maps/map-generation.server';
import { variantKey } from '../src/lib/gpx/filenames';
import { getCityConfig } from '../src/lib/config/city-config';
import { CITY } from '../src/lib/config/config';
import { CONTENT_DIR } from '../src/lib/config/config.server';
import { findGpxFiles, extractDateFromPath, buildSlug, detectTours } from '../src/loaders/rides';
import crypto from 'node:crypto';
import polylineCodec from '@mapbox/polyline';
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
  const allLocales = config.locales || [config.locale];
  const defaultLang = shortLang(config.locale);
  // Languages to generate: default (no prefix) + additional languages (with prefix)
  const languages = allLocales.map(shortLang);

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
  const geoDir = path.join('public', 'paths', 'geo');
  if (fs.existsSync(geoDir)) {
    // Load bike path pages to know which relations belong to which slug
    const { parseBikePathsYml } = await import('../src/lib/bike-paths/bikepaths-yml');
    const { scoreBikePath, isHardExcluded, SCORE_THRESHOLD } = await import('../src/lib/bike-paths/bike-path-scoring');
    const ymlPath = path.join(CONTENT_DIR, CITY, 'bikepaths.yml');
    if (fs.existsSync(ymlPath)) {
      const entries = parseBikePathsYml(fs.readFileSync(ymlPath, 'utf-8'));

      // Collect markdown slugs and their includes — these always get pages
      const bikePathsDir = path.join(CONTENT_DIR, CITY, 'bike-paths');
      const markdownSlugs = new Set<string>();
      const claimedByMarkdown = new Set<string>();
      const mdIncludesMap = new Map<string, string[]>();
      if (fs.existsSync(bikePathsDir)) {
        for (const file of fs.readdirSync(bikePathsDir).filter(f => f.endsWith('.md'))) {
          const mdSlug = file.replace(/\.md$/, '');
          const { data } = matter(fs.readFileSync(path.join(bikePathsDir, file), 'utf-8'));
          if (data.hidden) continue;
          markdownSlugs.add(mdSlug);
          const includes: string[] = data.includes ?? [];
          mdIncludesMap.set(mdSlug, includes);
          for (const inc of includes) claimedByMarkdown.add(inc);
          if (includes.length === 0) claimedByMarkdown.add(mdSlug);
        }
      }

      // Determine which YML slugs will become pages (not claimed by markdown, passes scoring)
      const pageSlugs = new Set<string>(markdownSlugs);
      for (const e of entries) {
        if (claimedByMarkdown.has(e.slug)) continue;
        if (isHardExcluded(e)) continue;
        // Score with routeOverlapCount=0 (conservative — some paths score higher with overlaps)
        if (scoreBikePath(e, 0) >= SCORE_THRESHOLD) pageSlugs.add(e.slug);
      }

      // Build slug → GeoJSON file paths map (only for entries that belong to page slugs)
      const slugGeoFiles = new Map<string, string[]>();
      for (const e of entries) {
        const files: string[] = [];
        for (const relId of e.osm_relations ?? []) {
          files.push(path.join(geoDir, `${relId}.geojson`));
        }
        if (files.length === 0 && e.osm_names?.length) {
          files.push(path.join(geoDir, `name-${e.slug}.geojson`));
        }
        if (files.length === 0 && e.segments?.length) {
          files.push(path.join(geoDir, `seg-${e.slug}.geojson`));
        }
        if (files.length > 0) {
          const existing = slugGeoFiles.get(e.slug) ?? [];
          existing.push(...files);
          slugGeoFiles.set(e.slug, existing);
        }
      }

      // Merge markdown includes into their parent slug's geo files
      for (const [mdSlug, includes] of mdIncludesMap) {
        const allFiles: string[] = [];
        for (const inc of includes) {
          const incFiles = slugGeoFiles.get(inc);
          if (incFiles) allFiles.push(...incFiles);
        }
        if (allFiles.length > 0) slugGeoFiles.set(mdSlug, allFiles);
      }

      // Remove entries that won't have pages
      for (const slug of slugGeoFiles.keys()) {
        if (!pageSlugs.has(slug)) slugGeoFiles.delete(slug);
      }

      // Generate a map for each slug that has a page and GeoJSON
      for (const [slug, geoFilePaths] of slugGeoFiles) {
        // Collect all coordinates from GeoJSON files
        const allPoints: [number, number][] = [];
        const geoContents: string[] = [];
        for (const geoPath of geoFilePaths) {
          if (!fs.existsSync(geoPath)) continue;
          const content = fs.readFileSync(geoPath, 'utf-8');
          geoContents.push(content);
          const geojson = JSON.parse(content);
          for (const feature of geojson.features ?? []) {
            if (feature.geometry?.type === 'LineString') {
              for (const coord of feature.geometry.coordinates) {
                allPoints.push([coord[1], coord[0]]); // [lat, lng] for polyline encoding
              }
            } else if (feature.geometry?.type === 'MultiLineString') {
              for (const line of feature.geometry.coordinates) {
                for (const coord of line) {
                  allPoints.push([coord[1], coord[0]]);
                }
              }
            }
          }
        }

        if (allPoints.length < 2) continue;

        const combinedHash = crypto.createHash('sha256')
          .update(geoContents.join('\n'))
          .digest('hex').slice(0, 16);
        const mapSlug = `path-${slug}`;

        for (const lang of languages) {
          const langPrefix = lang === defaultLang ? undefined : lang;

          if (!FORCE && !needsRegeneration(mapSlug, combinedHash, langPrefix)) {
            skipped++;
            continue;
          }

          const label = langPrefix ? `${mapSlug} [${lang}]` : mapSlug;
          console.log(`[maps] ${label}: generating bike path map...`);

          // Encode coordinates as polyline for the Google API
          const encoded = polylineCodec.encode(allPoints as [number, number][]);
          const url = buildStaticMapUrl(encoded, API_KEY!, lang, { size: '800x400', markers: false });
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
  }

  if (generated === 0 && skipped === 0) {
    console.log('[maps] No routes or rides found — nothing to generate');
  } else {
    console.log(`[maps] Done. Generated: ${generated}, Cached: ${skipped}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
