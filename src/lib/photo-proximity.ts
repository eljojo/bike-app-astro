interface Point {
  lat: number;
  lng: number;
}

interface PhotoCandidate {
  key: string;
  lat: number;
  lng: number;
  routeSlug: string;
  caption?: string;
  width?: number;
  height?: number;
}

const RADIUS_M = 200;
// At Ottawa's latitude (~45°), 1° lat ≈ 111km, 1° lng ≈ 78km
const LAT_MARGIN = RADIUS_M / 111_000; // ~0.0018°
const LNG_MARGIN = RADIUS_M / 78_000;  // ~0.0026°

/**
 * Find photos from other routes that are within RADIUS_M meters of the given route track.
 * Uses bounding box pre-filter then haversine for accuracy.
 */
export function findNearbyPhotos(
  trackPoints: Point[],
  allPhotos: PhotoCandidate[],
  currentRouteSlug: string,
): PhotoCandidate[] {
  if (trackPoints.length === 0 || allPhotos.length === 0) return [];

  // Compute route bounding box
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;
  for (const p of trackPoints) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  // Expand by margin
  minLat -= LAT_MARGIN;
  maxLat += LAT_MARGIN;
  minLng -= LNG_MARGIN;
  maxLng += LNG_MARGIN;

  const results: PhotoCandidate[] = [];

  for (const photo of allPhotos) {
    // Skip current route's photos
    if (photo.routeSlug === currentRouteSlug) continue;

    // Bounding box reject
    if (photo.lat < minLat || photo.lat > maxLat ||
        photo.lng < minLng || photo.lng > maxLng) {
      continue;
    }

    // Haversine check against nearest track point
    let minDist = Infinity;
    for (const p of trackPoints) {
      const d = haversineM(p.lat, p.lng, photo.lat, photo.lng);
      if (d < minDist) minDist = d;
      if (d <= RADIUS_M) break; // early exit
    }

    if (minDist <= RADIUS_M) {
      results.push(photo);
    }
  }

  return results;
}

/** Haversine distance in meters between two lat/lng points. */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
