import { haversineM, PHOTO_NEARBY_M } from './proximity';

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

// At Ottawa's latitude (~45°), 1° lat ≈ 111km, 1° lng ≈ 78km
const LAT_MARGIN = PHOTO_NEARBY_M / 111_000; // ~0.0018°
const LNG_MARGIN = PHOTO_NEARBY_M / 78_000;  // ~0.0026°

/**
 * Find media from other routes that are within PHOTO_NEARBY_M meters of the given route track.
 * Uses bounding box pre-filter then haversine for accuracy.
 */
export function findNearbyMedia(
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
      if (d <= PHOTO_NEARBY_M) break; // early exit
    }

    if (minDist <= PHOTO_NEARBY_M) {
      results.push(photo);
    }
  }

  return results;
}
