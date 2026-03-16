import { slugify } from '../slug';

/** GPX filename for a ride: "DD-slugified-name.gpx". */
export function rideGpxFilename(day: string, name: string): string {
  return `${day}-${slugify(name)}.gpx`;
}

/** GPX path for a route variant: "main.gpx" for the first, "variants/slugified-name.gpx" for additional. */
export function routeVariantGpxPath(name: string, isFirst: boolean): string {
  return isFirst ? 'main.gpx' : `variants/${slugify(name)}.gpx`;
}
