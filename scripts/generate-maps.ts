import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import sharp from 'sharp';
import { parseGpx } from '../src/lib/gpx';
import {
  mapThumbPaths, buildStaticMapUrl,
  variantKeyFromGpx, gpxHash, hashPath,
  needsRegeneration,
} from '../src/lib/map-generation';
import { getCityConfig } from '../src/lib/city-config';

const CONTENT_DIR = process.env.CONTENT_DIR || path.resolve('..', 'bike-routes');
const CITY = process.env.CITY || 'ottawa';
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

async function generateMapImages(pngBuffer: Buffer, paths: ReturnType<typeof mapThumbPaths>) {
  fs.mkdirSync(path.dirname(paths.thumb), { recursive: true });

  fs.writeFileSync(paths.full, pngBuffer);

  await sharp(pngBuffer)
    .resize(750, 750, { fit: 'cover' })
    .webp({ quality: 80 })
    .toFile(paths.thumb);

  await sharp(pngBuffer)
    .resize(375, 375, { fit: 'cover' })
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

  const routesDir = path.join(CONTENT_DIR, CITY, 'routes');
  if (!fs.existsSync(routesDir)) {
    console.log('[maps] No routes directory found — nothing to generate');
    return;
  }
  const slugs = fs.readdirSync(routesDir).filter(f =>
    fs.statSync(path.join(routesDir, f)).isDirectory()
  );

  let generated = 0;
  let skipped = 0;

  for (const slug of slugs) {
    const routeDir = path.join(routesDir, slug);
    const indexPath = path.join(routeDir, 'index.md');
    if (!fs.existsSync(indexPath)) continue;

    const { data: fm } = matter(fs.readFileSync(indexPath, 'utf-8'));
    const variants = fm.variants || [];
    if (variants.length === 0) continue;

    for (let i = 0; i < variants.length; i++) {
      const variant = variants[i];
      const variantKey = variantKeyFromGpx(variant.gpx);
      const gpxPath = path.join(routeDir, variant.gpx);

      if (!fs.existsSync(gpxPath)) {
        console.log(`[maps] ${slug}/${variantKey}: no GPX, skipping`);
        continue;
      }

      const gpxContent = fs.readFileSync(gpxPath, 'utf-8');
      const hash = gpxHash(gpxContent);
      const variantCacheKey = variantKey;

      for (const lang of languages) {
        // Default language maps go at root (no lang prefix), others get a lang/ prefix
        const langPrefix = lang === defaultLang ? undefined : lang;
        const cacheKey = slug + '/' + variantCacheKey;

        if (!FORCE && !needsRegeneration(cacheKey, hash, langPrefix)) {
          skipped++;
          continue;
        }

        const label = langPrefix ? `${slug}/${variantKey} [${lang}]` : `${slug}/${variantKey}`;
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

        // Generate variant-specific map images
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

  console.log(`[maps] Done. Generated: ${generated}, Cached: ${skipped}`);
}

main().catch(e => { console.error(e); process.exit(1); });
