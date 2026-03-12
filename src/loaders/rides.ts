import type { Loader } from 'astro/loaders';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { parseGpx, buildTrackFromPoints, type GpxTrack, type GpxPoint } from '../lib/gpx';
import { cityDir } from '../lib/config';
import { getCityConfig } from '../lib/city-config';
import { filterPrivacyZone, stripPrivacyPhotos, type PrivacyZoneConfig } from '../lib/privacy-zone';
import { renderMarkdownHtml } from '../lib/markdown-render';
import { slugify } from '../lib/slug';
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

  return Array.from(tourMap.values()).map(({ dirPath, ridePaths }) => {
    const rawSlug = dirPath.split('/').find((p, i) => i > 0 && isNaN(parseInt(p, 10)))!;
    const slug = slugify(rawSlug) || `tour-${dirPath.split('/')[0]}`;
    return { slug, dirPath, ridePaths: ridePaths.sort() };
  });
}

/** Build a slug from ride date and filename.
 * If a `handle` is provided (from sidecar frontmatter), it takes priority.
 * Otherwise, produce a name-only slug by stripping the date prefix from the filename
 * using the known date to match exactly (avoids greedily stripping numeric handle IDs).
 */
export function buildSlug(date: RideDate, gpxFilename: string, handle?: string): string {
  const dateFallback = `ride-${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;

  if (handle) return slugify(handle) || dateFallback;

  const baseName = gpxFilename.replace(/\.gpx$/i, '');
  const mm = String(date.month).padStart(2, '0');
  const dd = String(date.day).padStart(2, '0');

  // Try MM-DD- prefix first (multi-month tours: YYYY/tour-name/MM-DD-name.gpx)
  const mmddPrefix = `${mm}-${dd}-`;
  if (baseName.startsWith(mmddPrefix)) {
    const slug = slugify(baseName.slice(mmddPrefix.length));
    return slug || dateFallback;
  }

  // Try DD- prefix (zero-padded, then non-padded)
  const ddPrefix = `${dd}-`;
  if (baseName.startsWith(ddPrefix)) {
    const slug = slugify(baseName.slice(ddPrefix.length));
    return slug || dateFallback;
  }
  const dPrefix = `${date.day}-`;
  if (dPrefix !== ddPrefix && baseName.startsWith(dPrefix)) {
    const slug = slugify(baseName.slice(dPrefix.length));
    return slug || dateFallback;
  }

  const slug = slugify(baseName);
  return slug || dateFallback;
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
        const date = extractDateFromPath(gpxRelPath);
        if (!date) {
          logger.warn(`Could not extract date from path: ${gpxRelPath}`);
          continue;
        }

        const gpxFilename = path.basename(gpxRelPath);
        const gpxAbsPath = path.join(ridesDir, gpxRelPath);

        // Load optional sidecar .md (needed before slug generation for handle field)
        const sidecarPath = gpxAbsPath.replace(/\.gpx$/i, '.md');
        let sidecarFrontmatter: Record<string, unknown> = {};
        let body = '';
        if (fs.existsSync(sidecarPath)) {
          const raw = fs.readFileSync(sidecarPath, 'utf-8');
          const parsed = matter(raw);
          sidecarFrontmatter = parsed.data;
          body = parsed.content.trim();
        }

        const slug = buildSlug(date, gpxFilename, sidecarFrontmatter.handle as string | undefined);

        // Incremental caching
        const digest = computeRideDigest(ridesDir, gpxRelPath);
        const lastDigest = meta.get(`ride:${slug}:digest`);
        if (lastDigest === digest) {
          skipped++;
          continue;
        }

        // Parse GPX, apply privacy zone filter, then downsample points.
        // With 600+ rides, full-resolution points exhaust the heap during builds.
        // The elevation profile needs at most 200 samples; the map uses the polyline.
        let gpxTrack: GpxTrack;
        try {
          const gpxXml = fs.readFileSync(gpxAbsPath, 'utf-8');
          const parsed = parseGpx(gpxXml);

          // Apply privacy zone filter if enabled for this ride
          const privacyZoneEnabled = typeof sidecarFrontmatter.privacy_zone === 'boolean'
            ? sidecarFrontmatter.privacy_zone
            : privacyZone?.default_enabled ?? false;

          let filteredPoints = parsed.points;
          if (privacyZoneEnabled && privacyZone) {
            const zone: PrivacyZoneConfig = { lat: privacyZone.lat, lng: privacyZone.lng, radius_m: privacyZone.radius_m };
            // GpxPoint uses `lon`, privacy zone uses `lng` — map between them
            const mappedPoints = parsed.points.map(p => ({ lat: p.lat, lng: p.lon, ele: p.ele }));
            const filtered = filterPrivacyZone(mappedPoints, zone);
            filteredPoints = filtered.map(p => ({ lat: p.lat, lon: p.lng, ele: p.ele } as GpxPoint));
          }

          const MAX_POINTS = 200;
          if (filteredPoints.length > MAX_POINTS) {
            const step = Math.floor(filteredPoints.length / MAX_POINTS);
            filteredPoints = filteredPoints.filter((_, i) => i % step === 0 || i === filteredPoints.length - 1);
          }

          // Recompute metrics from filtered (and possibly downsampled) points
          gpxTrack = buildTrackFromPoints(filteredPoints);
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          logger.warn(`Failed to parse GPX ${gpxAbsPath}: ${message}`);
          continue;
        }

        // Load optional -media.yml
        const mediaYmlPath = gpxAbsPath.replace(/\.gpx$/i, '-media.yml');
        let media: RouteMedia[] = [];
        if (fs.existsSync(mediaYmlPath)) {
          const mediaRaw = fs.readFileSync(mediaYmlPath, 'utf-8');
          media = (yaml.load(mediaRaw) as RouteMedia[]) || [];
        }

        // Strip photo GPS coordinates that fall inside the privacy zone
        if (privacyZone && media.length > 0) {
          const privacyEnabled = typeof sidecarFrontmatter.privacy_zone === 'boolean'
            ? sidecarFrontmatter.privacy_zone
            : privacyZone.default_enabled;
          if (privacyEnabled) {
            const zone: PrivacyZoneConfig = { lat: privacyZone.lat, lng: privacyZone.lng, radius_m: privacyZone.radius_m };
            media = stripPrivacyPhotos(media, zone);
          }
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

        }

        const name = (sidecarFrontmatter.name as string)
          || nameFromFilename(gpxFilename, date);
        const status = (sidecarFrontmatter.status as string) || 'published';
        const country = (sidecarFrontmatter.country as string)
          || (tourFrontmatter.country as string)
          || undefined;
        const highlight = typeof sidecarFrontmatter.highlight === 'boolean'
          ? sidecarFrontmatter.highlight
          : undefined;
        const totalElevationGain = typeof sidecarFrontmatter.total_elevation_gain === 'number'
          ? sidecarFrontmatter.total_elevation_gain
          : undefined;
        const stravaId = typeof sidecarFrontmatter.strava_id === 'string'
          ? sidecarFrontmatter.strava_id
          : undefined;
        const ridePrivacyZone = typeof sidecarFrontmatter.privacy_zone === 'boolean'
          ? sidecarFrontmatter.privacy_zone
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
