export interface PrivacyZoneConfig {
  lat: number;
  lng: number;
  radius_m: number;
}

interface TrackPoint {
  lat: number;
  lng: number;
  ele?: number;
  time?: number;
}

/** Haversine distance in metres between two points. */
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isInsideZone(lat: number, lng: number, zone: PrivacyZoneConfig): boolean {
  return haversineM(lat, lng, zone.lat, zone.lng) <= zone.radius_m;
}

/**
 * Remove all track points within the privacy zone radius, then merge
 * remaining segments into one continuous array.
 */
export function filterPrivacyZone<T extends TrackPoint>(
  points: T[],
  zone: PrivacyZoneConfig,
): T[] {
  return points.filter((p) => !isInsideZone(p.lat, p.lng, zone));
}

/**
 * Strip lat/lng from photos that fall inside the privacy zone.
 * Returns new array (does not mutate input).
 */
export function stripPrivacyPhotos<T extends { lat?: number; lng?: number }>(
  photos: T[],
  zone: PrivacyZoneConfig,
): T[] {
  return photos.map((p) => {
    if (p.lat != null && p.lng != null && isInsideZone(p.lat, p.lng, zone)) {
      const { lat: _lat, lng: _lng, ...rest } = p;
      return rest as T;
    }
    return p;
  });
}
