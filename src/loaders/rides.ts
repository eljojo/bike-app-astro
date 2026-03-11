import type { Loader } from 'astro/loaders';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { parseGpx, type GpxTrack } from '../lib/gpx';
import { cityDir } from '../lib/config';
import { renderMarkdownHtml } from '../lib/markdown-render';
import type { RouteMedia } from './routes';

export interface RideDate {
  year: number;
  month: number;
  day: number;
}

export interface Tour {
  slug: string;
  dirPath: string;
  ridePaths: string[];
}

/**
 * Extract year, month, and day from a GPX file path relative to the rides/ directory.
 *
 * Supported structures:
 *   YYYY/MM/DD-name.gpx         → year from dir, month from dir, day from filename
 *   YYYY/MM/tour-name/DD-name.gpx → year from dir, month from dir, day from filename
 *   YYYY/tour-name/MM-DD-name.gpx → year from dir, month+day from filename
 */
export function extractDateFromPath(relativePath: string): RideDate | null {
  const parts = relativePath.split('/');
  const filename = parts[parts.length - 1].replace(/\.gpx$/i, '');

  // First component is always YYYY
  const year = parseInt(parts[0], 10);
  if (isNaN(year) || year < 1900 || year > 2100) return null;

  if (parts.length === 3) {
    const secondPart = parseInt(parts[1], 10);

    if (!isNaN(secondPart) && secondPart >= 1 && secondPart <= 12) {
      // YYYY/MM/DD-name.gpx — month from directory, day from filename
      const dayMatch = filename.match(/^(\d{1,2})-/);
      if (dayMatch) {
        const day = parseInt(dayMatch[1], 10);
        if (day >= 1 && day <= 31) {
          return { year, month: secondPart, day };
        }
      }
    } else if (isNaN(secondPart)) {
      // YYYY/tour-name/MM-DD-name.gpx — multi-month tour, month+day from filename
      const mmddMatch = filename.match(/^(\d{1,2})-(\d{1,2})-/);
      if (mmddMatch) {
        const month = parseInt(mmddMatch[1], 10);
        const day = parseInt(mmddMatch[2], 10);
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          return { year, month, day };
        }
      }
    }
  }

  if (parts.length === 4) {
    // YYYY/MM/tour-name/DD-name.gpx
    const month = parseInt(parts[1], 10);
    if (!isNaN(month) && month >= 1 && month <= 12) {
      const dayMatch = filename.match(/^(\d{1,2})-/);
      if (dayMatch) {
        const day = parseInt(dayMatch[1], 10);
        if (day >= 1 && day <= 31) {
          return { year, month, day };
        }
      }
    }

    // YYYY/tour-name/MM-DD-name.gpx (multi-month tour)
    if (isNaN(parseInt(parts[1], 10))) {
      const mmddMatch = filename.match(/^(\d{1,2})-(\d{1,2})-/);
      if (mmddMatch) {
        const month2 = parseInt(mmddMatch[1], 10);
        const day2 = parseInt(mmddMatch[2], 10);
        if (month2 >= 1 && month2 <= 12 && day2 >= 1 && day2 <= 31) {
          return { year, month: month2, day: day2 };
        }
      }
    }
  }

  return null;
}

/**
 * Detect tour directories from a list of GPX file paths (relative to rides/).
 *
 * A directory is a tour if:
 * - It contains .gpx files
 * - Its name is NOT a pure number (not YYYY or MM)
 */
export function detectTours(gpxPaths: string[]): Tour[] {
  const tourMap = new Map<string, { dirPath: string; ridePaths: string[] }>();

  for (const gpxPath of gpxPaths) {
    const parts = gpxPath.split('/');
    if (parts.length < 3) continue;

    // Look for a non-numeric directory in the path (not YYYY or MM)
    // Structure: YYYY/MM/tour-name/file.gpx or YYYY/tour-name/file.gpx
    let tourDirIndex = -1;
    for (let i = 1; i < parts.length - 1; i++) {
      if (isNaN(parseInt(parts[i], 10))) {
        tourDirIndex = i;
        break;
      }
    }

    if (tourDirIndex === -1) continue;

    const dirPath = parts.slice(0, tourDirIndex + 1).join('/');

    if (!tourMap.has(dirPath)) {
      tourMap.set(dirPath, { dirPath, ridePaths: [] });
    }
    tourMap.get(dirPath)!.ridePaths.push(gpxPath);
  }

  return Array.from(tourMap.values()).map(({ dirPath, ridePaths }) => ({
    slug: dirPath.split('/').find((p, i) => i > 0 && isNaN(parseInt(p, 10)))!,
    dirPath,
    ridePaths,
  }));
}

/** Build a slug from ride date and filename. */
export function buildSlug(date: RideDate, gpxFilename: string): string {
  const baseName = gpxFilename.replace(/\.gpx$/i, '');

  // Strip the leading date prefix from the filename to avoid duplication
  // For YYYY/MM/DD-name.gpx: strip DD-
  // For YYYY/tour/MM-DD-name.gpx: strip MM-DD-
  const stripped = baseName
    .replace(/^\d{1,2}-\d{1,2}-/, '')  // MM-DD- prefix
    .replace(/^\d{1,2}-/, '');           // DD- prefix

  const mm = String(date.month).padStart(2, '0');
  const dd = String(date.day).padStart(2, '0');

  return `${date.year}-${mm}-${dd}-${stripped}`;
}

/** Build an ISO date string from a RideDate. */
export function rideDateToIso(date: RideDate): string {
  const mm = String(date.month).padStart(2, '0');
  const dd = String(date.day).padStart(2, '0');
  return `${date.year}-${mm}-${dd}`;
}

/**
 * Recursively find all .gpx files under a directory.
 * Returns paths relative to the base directory.
 */
export function findGpxFiles(baseDir: string, dir: string = ''): string[] {
  const results: string[] = [];
  const absDir = dir ? path.join(baseDir, dir) : baseDir;

  if (!fs.existsSync(absDir)) return results;

  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const relativePath = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...findGpxFiles(baseDir, relativePath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.gpx')) {
      results.push(relativePath);
    }
  }

  return results;
}

/**
 * Compute an MD5 digest of a ride's relevant files for incremental caching.
 */
function computeRideDigest(ridesDir: string, gpxRelPath: string): string {
  const hash = createHash('md5');
  const gpxAbsPath = path.join(ridesDir, gpxRelPath);

  // Hash the GPX file
  const gpxStat = fs.statSync(gpxAbsPath);
  hash.update(`${gpxRelPath}:${gpxStat.mtimeMs}`);

  // Hash sidecar .md if it exists
  const sidecarPath = gpxAbsPath.replace(/\.gpx$/i, '.md');
  if (fs.existsSync(sidecarPath)) {
    const sidecarStat = fs.statSync(sidecarPath);
    hash.update(`sidecar:${sidecarStat.mtimeMs}`);
  }

  // Hash sidecar -media.yml if it exists
  const mediaPath = gpxAbsPath.replace(/\.gpx$/i, '-media.yml');
  if (fs.existsSync(mediaPath)) {
    const mediaStat = fs.statSync(mediaPath);
    hash.update(`media:${mediaStat.mtimeMs}`);
  }

  return hash.digest('hex');
}

/** Extract a human-readable name from a GPX filename. */
export function nameFromFilename(gpxFilename: string): string {
  return gpxFilename
    .replace(/\.gpx$/i, '')
    .replace(/^\d{1,2}-\d{1,2}-/, '')   // strip MM-DD- prefix
    .replace(/^\d{1,2}-/, '')             // strip DD- prefix
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

export function rideLoader(): Loader {
  return {
    name: 'ride-loader',
    load: async ({ store, meta, logger }) => {
      const ridesDir = path.join(cityDir, 'rides');
      if (!fs.existsSync(ridesDir)) {
        logger.warn(`Rides directory not found: ${ridesDir}`);
        return;
      }

      const gpxPaths = findGpxFiles(ridesDir);
      if (gpxPaths.length === 0) {
        logger.info('No GPX files found in rides directory');
        return;
      }

      // Detect tours for setting tour_slug on rides
      const tours = detectTours(gpxPaths);
      const tourByGpxPath = new Map<string, Tour>();
      for (const tour of tours) {
        for (const ridePath of tour.ridePaths) {
          tourByGpxPath.set(ridePath, tour);
        }
      }

      let loaded = 0;
      let skipped = 0;

      for (const gpxRelPath of gpxPaths) {
        const date = extractDateFromPath(gpxRelPath);
        if (!date) {
          logger.warn(`Could not extract date from path: ${gpxRelPath}`);
          continue;
        }

        const gpxFilename = path.basename(gpxRelPath);
        const slug = buildSlug(date, gpxFilename);

        // Incremental caching
        const digest = computeRideDigest(ridesDir, gpxRelPath);
        const lastDigest = meta.get(`ride:${slug}:digest`);
        if (lastDigest === digest) {
          skipped++;
          continue;
        }

        // Parse GPX
        const gpxAbsPath = path.join(ridesDir, gpxRelPath);
        let gpxTrack: GpxTrack;
        try {
          const gpxXml = fs.readFileSync(gpxAbsPath, 'utf-8');
          gpxTrack = parseGpx(gpxXml);
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          logger.warn(`Failed to parse GPX ${gpxAbsPath}: ${message}`);
          continue;
        }

        // Load optional sidecar .md
        const sidecarPath = gpxAbsPath.replace(/\.gpx$/i, '.md');
        let sidecarFrontmatter: Record<string, unknown> = {};
        let body = '';
        if (fs.existsSync(sidecarPath)) {
          const raw = fs.readFileSync(sidecarPath, 'utf-8');
          const parsed = matter(raw);
          sidecarFrontmatter = parsed.data;
          body = parsed.content.trim();
        }

        // Load optional -media.yml
        const mediaYmlPath = gpxAbsPath.replace(/\.gpx$/i, '-media.yml');
        let media: RouteMedia[] = [];
        if (fs.existsSync(mediaYmlPath)) {
          const mediaRaw = fs.readFileSync(mediaYmlPath, 'utf-8');
          media = (yaml.load(mediaRaw) as RouteMedia[]) || [];
        }

        // Load tour-level metadata if this ride belongs to a tour
        const tour = tourByGpxPath.get(gpxRelPath);
        let tourFrontmatter: Record<string, unknown> = {};
        if (tour) {
          const tourIndexPath = path.join(ridesDir, tour.dirPath, 'index.md');
          if (fs.existsSync(tourIndexPath)) {
            const tourRaw = fs.readFileSync(tourIndexPath, 'utf-8');
            tourFrontmatter = matter(tourRaw).data;
          }

          // Also check for tour-level media.yml if ride has no media
          if (media.length === 0) {
            const tourMediaPath = path.join(ridesDir, tour.dirPath, 'media.yml');
            if (fs.existsSync(tourMediaPath)) {
              const tourMediaRaw = fs.readFileSync(tourMediaPath, 'utf-8');
              media = (yaml.load(tourMediaRaw) as RouteMedia[]) || [];
            }
          }
        }

        const name = (sidecarFrontmatter.name as string)
          || nameFromFilename(gpxFilename);
        const status = (sidecarFrontmatter.status as string) || 'published';
        const country = (sidecarFrontmatter.country as string)
          || (tourFrontmatter.country as string)
          || undefined;
        const highlight = typeof sidecarFrontmatter.highlight === 'boolean'
          ? sidecarFrontmatter.highlight
          : undefined;
        const tags = Array.isArray(sidecarFrontmatter.tags)
          ? sidecarFrontmatter.tags
          : [];

        const renderedBody = body ? await renderMarkdownHtml(body) : '';
        const isoDate = rideDateToIso(date);

        // Build route-schema-compatible data
        const gpxTracks: Record<string, GpxTrack> = {
          [gpxFilename]: gpxTrack,
        };

        const variants = [{
          name: name,
          gpx: gpxFilename,
          distance_km: Math.round(gpxTrack.distance_m / 100) / 10,
        }];

        const data = {
          name,
          status,
          distance_km: Math.round(gpxTrack.distance_m / 100) / 10,
          tags,
          variants,
          created_at: isoDate,
          updated_at: isoDate,
          media,
          gpxTracks,
          gpxRelativePath: gpxRelPath,
          renderedBody,
          translations: {},

          // Ride-specific fields
          ride_date: isoDate,
          tour_slug: tour ? tour.slug : undefined,
          country,
          highlight,
          elapsed_time_s: gpxTrack.elapsed_time_s || undefined,
          moving_time_s: gpxTrack.moving_time_s || undefined,
          average_speed_kmh: gpxTrack.average_speed_kmh || undefined,
        };

        store.set({
          id: slug,
          data,
          body,
          digest,
        });
        meta.set(`ride:${slug}:digest`, digest);
        loaded++;
      }

      logger.info(`Loaded ${loaded} rides (${skipped} unchanged, skipped)`);
    },
  };
}
