import path from 'node:path';

/** Git-relative path for a route's GPX file. */
export function routeGpxGitPath(city: string, routeSlug: string, variantGpx: string): string {
  return `${city}/routes/${routeSlug}/${variantGpx}`;
}

/** Git-relative path for a ride's GPX file. */
export function rideGpxGitPath(city: string, gpxRelativePath: string): string {
  return `${city}/rides/${gpxRelativePath}`;
}

/** Absolute filesystem path for a route's GPX file. */
export function routeGpxPath(cityDir: string, routeSlug: string, variantGpx: string): string {
  return path.join(cityDir, 'routes', routeSlug, variantGpx);
}

/** Absolute filesystem path for a ride's GPX file. */
export function rideGpxPath(cityDir: string, gpxRelativePath: string): string {
  return path.join(cityDir, 'rides', gpxRelativePath);
}

/** Extract slug from GPX field — "variants/return.gpx" → "return", "main.gpx" → "main". */
export function variantSlug(gpxField: string): string {
  return path.basename(gpxField, '.gpx');
}

/** Build cache/map key — "variants/return.gpx" → "variants-return", "main.gpx" → "main". */
export function variantKey(gpxField: string): string {
  return gpxField.replace('.gpx', '').replace(/\//g, '-');
}

/** Extract filename — "variants/return.gpx" → "return.gpx". */
export function variantFilename(gpxField: string): string {
  return path.basename(gpxField);
}
