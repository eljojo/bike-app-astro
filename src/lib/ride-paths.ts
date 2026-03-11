import { CITY } from './config';

/** Parse a ride slug (YYYY-MM-DD-name) into directory and base filename. */
export function rideSlugToDir(slug: string, city: string = CITY): { dir: string; base: string } {
  const year = slug.slice(0, 4);
  const month = slug.slice(5, 7);
  const base = slug.slice(8);
  return { dir: `${city}/rides/${year}/${month}`, base };
}

/** Get all file paths for a ride from its slug. */
export function rideFilePaths(slug: string, city: string = CITY) {
  const { dir, base } = rideSlugToDir(slug, city);
  return {
    gpx: `${dir}/${base}.gpx`,
    sidecar: `${dir}/${base}.md`,
    media: `${dir}/${base}-media.yml`,
  };
}

/** Extract a ride slug from a relative path (e.g., rides/2026/01/23-name.gpx → 2026-01-23-name). */
export function rideSlugFromPath(relativePath: string): string {
  const cleaned = relativePath.replace(/^.*?rides\//, '');
  const parts = cleaned.split('/');
  const year = parts[0];
  const month = parts[1];
  const filename = parts[2].replace(/\.(gpx|md)$/, '').replace(/-media\.yml$/, '');
  return `${year}-${month}-${filename}`;
}
