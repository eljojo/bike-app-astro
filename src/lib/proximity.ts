import type { GpxPoint } from './gpx';

/** Haversine distance in meters between two lat/lng points. */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
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

/** Place is "nearby" a route track if within this distance. */
export const PLACE_NEAR_ROUTE_M = 300;
/** Photo is "nearby" a route track if within this distance. */
export const PHOTO_NEARBY_M = 200;
/** Photo is "nearby" a place pin if within this distance (larger — remote places like parks/beaches). */
export const PHOTO_NEAR_PLACE_M = 750;

export interface PlaceData {
  id: string;
  name: string;
  name_fr?: string;
  category: string;
  lat: number;
  lng: number;
  address?: string;
  website?: string;
  phone?: string;
  google_maps_url?: string;
  photo_key?: string;
}

export interface NearbyPlace extends PlaceData {
  distance_m: number;
}

// ~111km per degree of latitude; longitude shrinks by cos(lat)
function bboxMargin(latDeg: number, meters: number) {
  const dLat = meters / 111_000;
  const dLon = meters / (111_000 * Math.cos((latDeg * Math.PI) / 180));
  return { dLat, dLon };
}

export function findNearbyPlaces(trackPoints: GpxPoint[], places: PlaceData[]): NearbyPlace[] {
  if (trackPoints.length < 2) return [];

  // Bounding-box pre-filter: skip places that can't possibly be within threshold
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of trackPoints) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  const { dLat, dLon } = bboxMargin((minLat + maxLat) / 2, PLACE_NEAR_ROUTE_M);
  minLat -= dLat; maxLat += dLat;
  minLon -= dLon; maxLon += dLon;

  const candidates = places.filter(
    p => p.lat >= minLat && p.lat <= maxLat && p.lng >= minLon && p.lng <= maxLon,
  );

  if (candidates.length === 0) return [];

  const nearby: NearbyPlace[] = [];

  for (const place of candidates) {
    let minDist = Infinity;
    for (const tp of trackPoints) {
      const d = haversineM(tp.lat, tp.lon, place.lat, place.lng);
      if (d < minDist) minDist = d;
    }

    if (minDist <= PLACE_NEAR_ROUTE_M) {
      nearby.push({ ...place, distance_m: Math.round(minDist) });
    }
  }

  return nearby.sort((a, b) => a.distance_m - b.distance_m);
}
