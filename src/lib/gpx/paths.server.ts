import path from 'node:path';

/** Absolute filesystem path for a route's GPX file. */
export function routeGpxPath(cityDir: string, routeSlug: string, variantGpx: string): string {
  return path.join(cityDir, 'routes', routeSlug, variantGpx);
}

/** Absolute filesystem path for a ride's GPX file. */
export function rideGpxPath(cityDir: string, gpxRelativePath: string): string {
  return path.join(cityDir, 'rides', gpxRelativePath);
}
