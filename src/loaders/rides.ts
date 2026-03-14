// rides.ts — Public content collection loader for blog rides.
//
// Reads ride GPX files via ride-file-reader.ts (shared I/O layer),
// then applies privacy zone filtering, downsamples track points to 200,
// renders markdown, and stores entries in Astro's content collection.
//
// Data flow:
//   ride-file-reader.ts → rides.ts → Astro content collection → static pages
//
// Memory: processes one ride at a time. With 600+ rides, full-resolution
// GPX points exhaust the heap — downsampling to 200 points is essential.

import type { Loader } from 'astro/loaders';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { buildTrackFromPoints, type GpxTrack, type GpxPoint } from '../lib/gpx';
import { cityDir } from '../lib/config/config';
import { getCityConfig } from '../lib/config/city-config';
import { computeFileDigest } from '../lib/directory-digest';
import { filterPrivacyZone, stripPrivacyPhotos, type PrivacyZoneConfig } from '../lib/privacy-zone';
import { renderMarkdownHtml } from '../lib/markdown/markdown-render';
import { slugify } from '../lib/slug';
import type { RouteMedia } from './route-file-reader';
import { readRideFile } from './ride-file-reader';

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
    const isNumericDir = /^\d+$/.test(parts[1]);
    const secondPart = parseInt(parts[1], 10);

    if (isNumericDir && secondPart >= 1 && secondPart <= 12) {
      // YYYY/MM/DD-name.gpx — month from directory, day from filename
      const dayMatch = filename.match(/^(\d{1,2})-/);
      if (dayMatch) {
        const day = parseInt(dayMatch[1], 10);
        if (day >= 1 && day <= 31) {
          return { year, month: secondPart, day };
        }
      }
    } else if (!isNumericDir) {
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
    if (!/^\d+$/.test(parts[1])) {
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
    // Use /^\d+$/ instead of parseInt — parseInt('2025-eurobiketrip') returns 2025, not NaN
    let tourDirIndex = -1;
    for (let i = 1; i < parts.length - 1; i++) {
      if (!/^\d+$/.test(parts[i])) {
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

  return Array.from(tourMap.values()).map(({ dirPath, ridePaths }) => {
    const rawSlug = dirPath.split('/').find((p, i) => i > 0 && !/^\d+$/.test(p))!;
    const slug = slugify(rawSlug) || `tour-${dirPath.split('/')[0]}`;
    return { slug, dirPath, ridePaths: ridePaths.sort() };
  });
}

/** Build a slug from ride date and filename.
 * Standalone rides get date-prefixed slugs (2026-01-23-winter-ride).
 * Tour rides get name-only slugs (scoped by tour directory).
 */
export function buildSlug(date: RideDate, gpxFilename: string, isTour?: boolean): string {
  const yyyy = String(date.year);
  const mm = String(date.month).padStart(2, '0');
  const dd = String(date.day).padStart(2, '0');
  const dateFallback = `ride-${yyyy}-${mm}-${dd}`;

  const baseName = gpxFilename.replace(/\.gpx$/i, '');

  // Strip date prefix from filename to get the name portion
  let name: string;

  // Try MM-DD- prefix first (multi-month tours: YYYY/tour-name/MM-DD-name.gpx)
  const mmddPrefix = `${mm}-${dd}-`;
  if (baseName.startsWith(mmddPrefix)) {
    name = baseName.slice(mmddPrefix.length);
  // Try DD- prefix (zero-padded, then non-padded)
  } else if (baseName.startsWith(`${dd}-`)) {
    name = baseName.slice(`${dd}-`.length);
  } else if (`${date.day}-` !== `${dd}-` && baseName.startsWith(`${date.day}-`)) {
    name = baseName.slice(`${date.day}-`.length);
  } else {
    name = baseName;
  }

  const slug = slugify(name);
  if (!slug) return dateFallback;

  // Tour rides: name-only slug (scoped by tour directory)
  if (isTour) return slug;

  // Standalone rides: date-prefixed slug
  return `${yyyy}-${mm}-${dd}-${slug}`;
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

  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const relativePath = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...findGpxFiles(baseDir, relativePath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.gpx')) {
      results.push(relativePath);
    }
  }

  return results;
}

/** Extract a human-readable name from a GPX filename. */
export function nameFromFilename(gpxFilename: string, date?: RideDate): string {
  const slug = date
    ? buildSlug(date, gpxFilename)
    : gpxFilename.replace(/\.gpx$/i, '');
  return slug
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

      // Load privacy zone config once (if configured for this city)
      const privacyZone = getCityConfig().privacy_zone;

      let loaded = 0;
      let skipped = 0;

      for (const gpxRelPath of gpxPaths) {
        const gpxAbsPath = path.join(ridesDir, gpxRelPath);
        const sidecarPath = gpxAbsPath.replace(/\.gpx$/i, '.md');
        const mediaYmlDigestPath = gpxAbsPath.replace(/\.gpx$/i, '-media.yml');

        // Incremental caching — need date+slug before checking digest
        const date = extractDateFromPath(gpxRelPath);
        if (!date) {
          logger.warn(`Could not extract date from path: ${gpxRelPath}`);
          continue;
        }

        const gpxFilename = path.basename(gpxRelPath);
        const isTour = tourByGpxPath.has(gpxRelPath);
        const slug = buildSlug(date, gpxFilename, isTour);

        const digest = computeFileDigest([gpxAbsPath, sidecarPath, mediaYmlDigestPath]);
        const lastDigest = meta.get(`ride:${slug}:digest`);
        if (lastDigest === digest) {
          skipped++;
          continue;
        }

        const tour = tourByGpxPath.get(gpxRelPath);
        const parsed = readRideFile(ridesDir, gpxRelPath, tour?.slug);
        if (!parsed) continue;

        // Apply privacy zone filtering to track points
        const privacyZoneEnabled = typeof parsed.frontmatter.privacy_zone === 'boolean'
          ? parsed.frontmatter.privacy_zone
          : privacyZone?.default_enabled ?? false;

        let filteredPoints = parsed.gpxTrack.points;
        if (privacyZoneEnabled && privacyZone) {
          const zone: PrivacyZoneConfig = { lat: privacyZone.lat, lng: privacyZone.lng, radius_m: privacyZone.radius_m };
          const mappedPoints = parsed.gpxTrack.points.map(p => ({ lat: p.lat, lng: p.lon, ele: p.ele }));
          const filtered = filterPrivacyZone(mappedPoints, zone);
          filteredPoints = filtered.map(p => ({ lat: p.lat, lon: p.lng, ele: p.ele } as GpxPoint));
        }

        // Downsample to max 200 points for heap efficiency
        const MAX_POINTS = 200;
        if (filteredPoints.length > MAX_POINTS) {
          const step = Math.floor(filteredPoints.length / MAX_POINTS);
          filteredPoints = filteredPoints.filter((_, i) => i % step === 0 || i === filteredPoints.length - 1);
        }

        const gpxTrack: GpxTrack = buildTrackFromPoints(filteredPoints);

        // Strip photo GPS coordinates that fall inside the privacy zone
        let media: RouteMedia[] = parsed.media;
        if (privacyZone && media.length > 0) {
          const privacyEnabled = typeof parsed.frontmatter.privacy_zone === 'boolean'
            ? parsed.frontmatter.privacy_zone
            : privacyZone.default_enabled;
          if (privacyEnabled) {
            const zone: PrivacyZoneConfig = { lat: privacyZone.lat, lng: privacyZone.lng, radius_m: privacyZone.radius_m };
            media = stripPrivacyPhotos(media, zone);
          }
        }

        // Load tour-level metadata if this ride belongs to a tour
        let tourFrontmatter: Record<string, unknown> = {};
        if (tour) {
          const tourIndexPath = path.join(ridesDir, tour.dirPath, 'index.md');
          if (fs.existsSync(tourIndexPath)) {
            const tourRaw = fs.readFileSync(tourIndexPath, 'utf-8');
            tourFrontmatter = matter(tourRaw).data;
          }
        }

        const name = (parsed.frontmatter.name as string)
          || nameFromFilename(gpxFilename, date);
        const status = (parsed.frontmatter.status as string) || 'published';
        const country = (parsed.frontmatter.country as string)
          || (tourFrontmatter.country as string)
          || undefined;
        const highlight = typeof parsed.frontmatter.highlight === 'boolean'
          ? parsed.frontmatter.highlight
          : undefined;
        const totalElevationGain = typeof parsed.frontmatter.total_elevation_gain === 'number'
          ? parsed.frontmatter.total_elevation_gain
          : undefined;
        const stravaId = typeof parsed.frontmatter.strava_id === 'string'
          ? parsed.frontmatter.strava_id
          : undefined;
        const ridePrivacyZone = typeof parsed.frontmatter.privacy_zone === 'boolean'
          ? parsed.frontmatter.privacy_zone
          : undefined;
        const tags = Array.isArray(parsed.frontmatter.tags)
          ? parsed.frontmatter.tags
          : [];

        const renderedBody = parsed.body ? await renderMarkdownHtml(parsed.body) : '';
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
          total_elevation_gain: totalElevationGain,
          strava_id: stravaId,
          privacy_zone: ridePrivacyZone,
          elapsed_time_s: gpxTrack.elapsed_time_s || undefined,
          moving_time_s: gpxTrack.moving_time_s || undefined,
          average_speed_kmh: gpxTrack.average_speed_kmh || undefined,
        };

        store.set({
          id: slug,
          data,
          body: parsed.body,
          digest,
        });
        meta.set(`ride:${slug}:digest`, digest);
        loaded++;
      }

      logger.info(`Loaded ${loaded} rides (${skipped} unchanged, skipped)`);
    },
  };
}
