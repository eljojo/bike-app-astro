import { haversineM } from './proximity';

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
 * Strip lat/lng from media that fall inside the privacy zone.
 * Returns new array (does not mutate input).
 */
export function stripPrivacyMedia<T extends { lat?: number; lng?: number }>(
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
