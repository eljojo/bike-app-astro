import { slugify } from '../slug';

/** GPX filename for a ride: "DD-slugified-name.gpx". */
export function rideGpxFilename(day: string, name: string): string {
  return `${day}-${slugify(name)}.gpx`;
}

/** GPX path for a route variant: "main.gpx" for the first, "variants/slugified-name.gpx" for additional. */
export function routeVariantGpxPath(name: string, isFirst: boolean): string {
  return isFirst ? 'main.gpx' : `variants/${slugify(name)}.gpx`;
}

/** Git-relative path for a route GPX file. Pure string interpolation. */
export function routeGpxGitPath(city: string, routeSlug: string, variantGpx: string): string {
  return `${city}/routes/${routeSlug}/${variantGpx}`;
}

/** Git-relative path for a ride GPX file. Pure string interpolation. */
export function rideGpxGitPath(city: string, gpxRelativePath: string): string {
  return `${city}/rides/${gpxRelativePath}`;
}

/** Build cache/map key — "variants/return.gpx" → "variants-return", "main.gpx" → "main". */
export function variantKey(gpxField: string): string {
  return gpxField.replace('.gpx', '').replace(/\//g, '-');
}

/** Extract slug from GPX field — "variants/return.gpx" → "return", "main.gpx" → "main". */
export function variantSlug(gpxField: string): string {
  const filename = gpxField.includes('/') ? gpxField.split('/').pop()! : gpxField;
  return filename.replace(/\.gpx$/i, '');
}

/** Extract filename — "variants/return.gpx" → "return.gpx", "main.gpx" → "main.gpx". */
export function variantFilename(gpxField: string): string {
  return gpxField.includes('/') ? gpxField.split('/').pop()! : gpxField;
}
