import type { Tour } from '../loaders/rides';

export interface RideSlugEntry {
  gpxRelPath: string;
  slug: string;
}

/**
 * Generate Cloudflare _redirects lines for tour rides:
 * /rides/{slug} → /tours/{tour}/{slug}
 * /rides/{slug}/map → /tours/{tour}/{slug}/map
 *
 * Standalone rides are skipped — their redirects live in redirects.yml.
 */
export function generateTourRedirects(tours: Tour[], rides: RideSlugEntry[]): string[] {
  const tourByGpxPath = new Map<string, string>();
  for (const tour of tours) {
    for (const ridePath of tour.ridePaths) {
      tourByGpxPath.set(ridePath, tour.slug);
    }
  }

  const lines: string[] = [];
  for (const ride of rides) {
    const tourSlug = tourByGpxPath.get(ride.gpxRelPath);
    if (!tourSlug) continue;

    lines.push(`/rides/${ride.slug}  /tours/${tourSlug}/${ride.slug}  301`);
    lines.push(`/rides/${ride.slug}/map  /tours/${tourSlug}/${ride.slug}/map  301`);
  }

  return [...new Set(lines)];
}
