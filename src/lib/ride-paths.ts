import { CITY } from './config';

/**
 * Derive file paths from a GPX relative path (relative to rides/ directory).
 * This is the primary way to get file paths for rides with name-only slugs.
 */
export function rideFilePathsFromRelPath(gpxRelPath: string, city: string = CITY) {
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
export function rideFilePathsWithTour(gpxRelPath: string, tourSlug: string | undefined, city: string = CITY) {
  if (!tourSlug) return rideFilePathsFromRelPath(gpxRelPath, city);

  const parts = gpxRelPath.split('/');
  const filename = parts.pop()!;
  const newPath = [...parts, tourSlug, filename].join('/');
  return rideFilePathsFromRelPath(newPath, city);
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
