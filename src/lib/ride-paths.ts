import { slugify } from './slug';

/**
 * Derive file paths from a GPX relative path (relative to rides/ directory).
 * This is the primary way to get file paths for rides with name-only slugs.
 */
export function rideFilePathsFromRelPath(gpxRelPath: string, city: string) {
  const base = gpxRelPath.replace(/\.gpx$/i, '');
  return {
    gpx: `${city}/rides/${gpxRelPath}`,
    sidecar: `${city}/rides/${base}.md`,
    media: `${city}/rides/${base}-media.yml`,
  };
}

/**
 * Compute file paths for a ride when its tour assignment changes.
 * Inserts/removes the tour slug directory in the path structure.
 */
export function rideFilePathsWithTour(gpxRelPath: string, tourSlug: string | undefined, city: string) {
  if (!tourSlug) return rideFilePathsFromRelPath(gpxRelPath, city);

  const parts = gpxRelPath.split('/');
  const filename = parts.pop()!;
  const newPath = [...parts, tourSlug, filename].join('/');
  return rideFilePathsFromRelPath(newPath, city);
}

/**
 * Compute gpxRelativePath for a new ride from its date, GPX filename, and optional tour.
 * Used by ride-save.ts when creating new rides (no pre-existing path).
 */
export function deriveGpxRelativePath(rideDate: string, gpxFilename: string, tourSlug?: string): string {
  if (!rideDate) throw new Error('ride_date is required to compute GPX path');
  if (!gpxFilename) throw new Error('GPX filename is required to compute GPX path');
  const [year, month] = rideDate.split('-');
  if (!year || !month) throw new Error(`Invalid ride_date format: ${rideDate}`);
  const parts = [year, month];
  if (tourSlug) parts.push(tourSlug);
  parts.push(gpxFilename);
  return parts.join('/');
}

/**
 * Compute the slug for a new ride.
 * Standalone rides get date-prefixed slugs (2026-03-15-morning-ride).
 * Tour rides keep name-only slugs (day-1) since the tour directory scopes them.
 */
export function resolveNewRideSlug(name: string, rideDate: string, tourSlug?: string): string {
  const nameSlug = slugify(name);
  if (tourSlug) return nameSlug;

  const [year, month, day] = rideDate.split('-');
  return `${year}-${month}-${day}-${nameSlug}`;
}

/**
 * Compute a new gpxRelPath by replacing the slug portion of the filename.
 * Preserves the date prefix and directory structure.
 *
 * Examples:
 *   ("2026/03/23-morning-ride.gpx", "sunrise-ride") → "2026/03/23-sunrise-ride.gpx"
 *   ("2025/07/euro-tour/15-paris-to-lyon.gpx", "paris-lyon") → "2025/07/euro-tour/15-paris-lyon.gpx"
 */
export function renameGpxRelPath(gpxRelPath: string, newSlug: string): string {
  const parts = gpxRelPath.split('/');
  const filename = parts[parts.length - 1];
  // Extract date prefix (DD- or MM-DD-) from filename
  const dateMatch = filename.match(/^(\d{1,2}-\d{1,2}-|\d{1,2}-)/);
  const datePrefix = dateMatch ? dateMatch[0] : '';
  parts[parts.length - 1] = `${datePrefix}${newSlug}.gpx`;
  return parts.join('/');
}

/**
 * Extract a name-only ride slug from a relative path.
 * Strips date prefixes to produce URL-friendly slugs matching Rails handles.
 *
 * Examples:
 *   rides/2026/01/23-winter-ride.gpx → winter-ride
 *   rides/2025/07/euro-tour/15-paris-to-lyon.gpx → paris-to-lyon
 *   rides/2023/long-tour/01-23-first-day.gpx → first-day
 */
export function rideSlugFromPath(relativePath: string): string {
  const cleaned = relativePath.replace(/^.*?rides\//, '');
  const parts = cleaned.split('/');
  if (parts.length < 3) {
    throw new Error(`Invalid ride path: ${relativePath} (expected at least YYYY/MM/file)`);
  }
  const filename = parts[parts.length - 1]
    .replace(/\.(gpx|md)$/, '')
    .replace(/-media\.yml$/, '');
  // Strip date prefixes (DD- or MM-DD-)
  return filename
    .replace(/^\d{1,2}-\d{1,2}-/, '')
    .replace(/^\d{1,2}-/, '');
}
