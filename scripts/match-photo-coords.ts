/**
 * Match CDN photos to Apple Photos originals and extract GPS coordinates.
 *
 * Usage:
 *   npx tsx scripts/match-photo-coords.ts photo_dates.json [--apply] [--dry-run]
 *
 * Stages:
 *   1. Reads photo_dates.json (blob_key → ride date)
 *   2. Downloads each photo from CDN, computes dhash
 *   3. Lists Apple Photos candidates (±1 day from ride date)
 *   4. Computes dhash for each candidate (cached across runs)
 *   5. Finds best match by hamming distance (threshold < 10)
 *   6. Extracts GPS + DateTimeOriginal from matched original
 *   7. Outputs photo_coords.json
 *   8. --apply mode: updates media.yml files in bike-routes repo
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import ExifReader from 'exif-reader';
import yaml from 'js-yaml';

const execFileAsync = promisify(execFile);

const APPLE_PHOTOS_ROOT = '/mnt/apple-photos';
const CDN_BASE = 'https://cdn.ottawabybike.ca';
const HASH_CACHE_PATH = '.data/photo-hash-cache.json';
const OUTPUT_PATH = 'photo_coords.json';
const CONCURRENCY = 8;
const HAMMING_THRESHOLD = 10;

// --- Types ---

interface PhotoDates {
  [blobKey: string]: string; // ISO 8601 date
}

interface HashCache {
  [filePath: string]: string; // hex hash
}

interface MatchResult {
  blobKey: string;
  lat: number;
  lng: number;
  capturedAt?: string;
  matchedFile: string;
  hammingDistance: number;
}

interface PhotoCoord {
  lat: number;
  lng: number;
  captured_at?: string;
}

// --- Dhash ---

/**
 * Get raw grayscale pixels (9x8) from an image.
 * Uses ImageMagick for HEIC files (sharp/vips can't decode H.265),
 * sharp for everything else.
 */
async function getPixels(input: string | Buffer): Promise<Buffer> {
  if (typeof input === 'string' && /\.heic$/i.test(input)) {
    const { stdout } = await execFileAsync('magick', [
      input, '-resize', '9x8!', '-colorspace', 'gray', '-depth', '8', 'gray:-',
    ], { encoding: 'buffer', maxBuffer: 1024 * 1024 });
    return Buffer.from(stdout);
  }
  return sharp(input).resize(9, 8, { fit: 'fill' }).grayscale().raw().toBuffer();
}

/**
 * Compute a 64-bit difference hash (dhash) from an image.
 * Resize to 9x8 grayscale, compare adjacent horizontal pixels.
 * Returns a BigInt representing the 64-bit hash.
 */
async function computeDhash(input: string | Buffer): Promise<bigint> {
  const pixels = await getPixels(input);
  let hash = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = pixels[y * 9 + x];
      const right = pixels[y * 9 + x + 1];
      if (left > right) {
        hash |= 1n << BigInt(y * 8 + x);
      }
    }
  }
  return hash;
}

/** Hamming distance between two 64-bit hashes. */
function hammingDistance(a: bigint, b: bigint): number {
  let xor = a ^ b;
  let count = 0;
  while (xor > 0n) {
    count += Number(xor & 1n);
    xor >>= 1n;
  }
  return count;
}

// --- EXIF extraction ---

/** Extract GPS coordinates and DateTimeOriginal from a file via sharp metadata + exif-reader. */
async function extractExifFromOriginal(filePath: string): Promise<{ lat: number; lng: number; capturedAt?: string } | null> {
  try {
    const metadata = await sharp(filePath).metadata();
    if (!metadata.exif) return null;

    const exif = ExifReader(metadata.exif);
    const gps = exif?.GPSInfo;
    if (!gps?.GPSLatitude || !gps?.GPSLongitude) return null;

    const lat = dmsToDecimal(
      gps.GPSLatitude as [number, number, number],
      gps.GPSLatitudeRef as string,
    );
    const lng = dmsToDecimal(
      gps.GPSLongitude as [number, number, number],
      gps.GPSLongitudeRef as string,
    );

    if (!isFinite(lat) || !isFinite(lng)) return null;

    let capturedAt: string | undefined;
    const dto = exif?.Photo?.DateTimeOriginal;
    if (dto instanceof Date) {
      capturedAt = dto.toISOString();
    }

    return { lat: round6(lat), lng: round6(lng), capturedAt };
  } catch {
    return null;
  }
}

function dmsToDecimal(dms: [number, number, number], ref: string): number {
  const [deg, min, sec] = dms;
  let decimal = deg + min / 60 + sec / 3600;
  if (ref === 'S' || ref === 'W') decimal = -decimal;
  return decimal;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

// --- Hash cache ---

function loadHashCache(): HashCache {
  try {
    return JSON.parse(fs.readFileSync(HASH_CACHE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveHashCache(cache: HashCache): void {
  fs.mkdirSync(path.dirname(HASH_CACHE_PATH), { recursive: true });
  fs.writeFileSync(HASH_CACHE_PATH, JSON.stringify(cache));
}

// --- Date helpers ---

function formatDateDir(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/** Get candidate Apple Photos directories for a ride date (±1 day for timezone). */
function getCandidateDirs(rideDate: string): string[] {
  const date = new Date(rideDate);
  const dirs = [-1, 0, 1].map(offset => {
    const d = addDays(date, offset);
    return path.join(APPLE_PHOTOS_ROOT, formatDateDir(d));
  });
  return dirs.filter(d => fs.existsSync(d));
}

/** List image files in candidate directories. */
function listCandidateFiles(dirs: string[]): string[] {
  return dirs.flatMap(dir => {
    try {
      return fs.readdirSync(dir)
        .filter(f => /\.(heic|jpg|jpeg)$/i.test(f))
        .map(f => path.join(dir, f));
    } catch {
      return [];
    }
  });
}

// --- CDN download ---

async function downloadFromCdn(blobKey: string): Promise<Buffer> {
  const url = `${CDN_BASE}/${blobKey}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

// --- Process a single photo ---

async function processPhoto(
  blobKey: string,
  rideDate: string,
  hashCache: HashCache,
): Promise<MatchResult | null> {
  // Download and hash CDN photo
  let cdnBuffer: Buffer;
  try {
    cdnBuffer = await downloadFromCdn(blobKey);
  } catch (err) {
    console.error(`  Failed to download ${blobKey}: ${err}`);
    return null;
  }

  let cdnHash: bigint;
  try {
    cdnHash = await computeDhash(cdnBuffer);
  } catch (err) {
    console.error(`  Failed to hash CDN image ${blobKey}: ${err}`);
    return null;
  }

  // Find candidate Apple Photos
  const candidateDirs = getCandidateDirs(rideDate);
  if (candidateDirs.length === 0) {
    return null;
  }

  const candidateFiles = listCandidateFiles(candidateDirs);
  if (candidateFiles.length === 0) {
    return null;
  }

  // Compare with each candidate
  let bestMatch: { file: string; distance: number } | null = null;

  for (const file of candidateFiles) {
    let candidateHash: bigint;

    // Check cache
    const cached = hashCache[file];
    if (cached) {
      candidateHash = BigInt(`0x${cached}`);
    } else {
      try {
        candidateHash = await computeDhash(file);
        hashCache[file] = candidateHash.toString(16).padStart(16, '0');
      } catch (err) {
        console.error(`  Failed to hash ${file}: ${err}`);
        continue;
      }
    }

    const dist = hammingDistance(cdnHash, candidateHash);
    if (dist < HAMMING_THRESHOLD && (!bestMatch || dist < bestMatch.distance)) {
      bestMatch = { file, distance: dist };
      if (dist === 0) break; // Perfect match
    }
  }

  if (!bestMatch) return null;

  // Extract EXIF from the matched original
  const exif = await extractExifFromOriginal(bestMatch.file);
  if (!exif) return null;

  return {
    blobKey,
    lat: exif.lat,
    lng: exif.lng,
    capturedAt: exif.capturedAt,
    matchedFile: bestMatch.file,
    hammingDistance: bestMatch.distance,
  };
}

// --- Apply to media.yml ---

function applyToMediaYml(coords: Record<string, PhotoCoord>): number {
  const contentDir = process.env.CONTENT_DIR || '../bike-routes';
  const city = process.env.CITY || 'ottawa';
  const routesDir = path.join(contentDir, city, 'routes');

  if (!fs.existsSync(routesDir)) {
    console.error(`Routes directory not found: ${routesDir}`);
    return 0;
  }

  let updatedCount = 0;
  const routeSlugs = fs.readdirSync(routesDir).filter(f =>
    fs.statSync(path.join(routesDir, f)).isDirectory()
  );

  for (const slug of routeSlugs) {
    const mediaPath = path.join(routesDir, slug, 'media.yml');
    if (!fs.existsSync(mediaPath)) continue;

    const raw = fs.readFileSync(mediaPath, 'utf-8');
    const media = (yaml.load(raw) as Array<Record<string, unknown>>) || [];
    let changed = false;

    for (const entry of media) {
      const key = entry.key as string;
      const coord = coords[key];
      if (!coord) continue;

      // Only set if not already present
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
    }

    if (changed) {
      const output = yaml.dump(media, { flowLevel: -1, lineWidth: -1 });
      fs.writeFileSync(mediaPath, output);
      updatedCount++;
      console.log(`  Updated ${slug}/media.yml`);
    }
  }

  return updatedCount;
}

// --- Batch processing ---

async function processBatch<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const jsonFile = args.find(a => !a.startsWith('--'));
  const applyMode = args.includes('--apply');
  const dryRun = args.includes('--dry-run');

  if (!jsonFile) {
    console.error('Usage: npx tsx scripts/match-photo-coords.ts photo_dates.json [--apply] [--dry-run]');
    process.exit(1);
  }

  if (!fs.existsSync(jsonFile)) {
    console.error(`File not found: ${jsonFile}`);
    process.exit(1);
  }

  const photoDates: PhotoDates = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
  const blobKeys = Object.keys(photoDates);
  console.log(`Loaded ${blobKeys.length} photos from ${jsonFile}`);

  if (!fs.existsSync(APPLE_PHOTOS_ROOT)) {
    console.error(`Apple Photos root not found: ${APPLE_PHOTOS_ROOT}`);
    process.exit(1);
  }

  const hashCache = loadHashCache();
  let matched = 0;
  let failed = 0;
  let noMatch = 0;
  let processed = 0;
  const coords: Record<string, PhotoCoord> = {};

  const entries = blobKeys.map(key => ({ key, date: photoDates[key] }));

  await processBatch(entries, CONCURRENCY, async ({ key, date }) => {
    const result = await processPhoto(key, date, hashCache);
    processed++;

    if (result) {
      matched++;
      coords[result.blobKey] = {
        lat: result.lat,
        lng: result.lng,
        ...(result.capturedAt && { captured_at: result.capturedAt }),
      };
    } else if (result === null) {
      // Could be download failure or no match
      const candidateDirs = getCandidateDirs(date);
      if (candidateDirs.length === 0 || listCandidateFiles(candidateDirs).length === 0) {
        noMatch++;
      } else {
        noMatch++;
      }
    }

    // Progress every 10 photos
    if (processed % 10 === 0 || processed === blobKeys.length) {
      process.stdout.write(`\rProgress: ${processed}/${blobKeys.length} (${matched} matched, ${failed} failed)`);
    }

    // Save hash cache periodically
    if (processed % 100 === 0) {
      saveHashCache(hashCache);
    }
  });

  console.log(''); // newline after progress
  saveHashCache(hashCache);

  console.log(`\nResults:`);
  console.log(`  Matched: ${matched}`);
  console.log(`  No match: ${noMatch}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total: ${blobKeys.length}`);

  // Write output
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(coords, null, 2));
  console.log(`\nWrote ${Object.keys(coords).length} coordinates to ${OUTPUT_PATH}`);

  // Apply mode
  if (applyMode && !dryRun) {
    console.log('\nApplying coordinates to media.yml files...');
    const updated = applyToMediaYml(coords);
    console.log(`Updated ${updated} media.yml files`);
  } else if (applyMode && dryRun) {
    console.log('\nDry run — would apply coordinates to media.yml files');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
