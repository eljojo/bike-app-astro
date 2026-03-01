import { haversine, type GpxPoint } from './gpx';

export interface PlaceData {
  id: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  address?: string;
  website?: string;
  phone?: string;
  google_maps_url?: string;
}

export interface NearbyPlace extends PlaceData {
  distance_m: number;
}

const PROXIMITY_THRESHOLD_M = 300;

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
  const { dLat, dLon } = bboxMargin((minLat + maxLat) / 2, PROXIMITY_THRESHOLD_M);
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
      const d = haversine(tp, { lat: place.lat, lon: place.lng });
      if (d < minDist) minDist = d;
    }

    if (minDist <= PROXIMITY_THRESHOLD_M) {
      nearby.push({ ...place, distance_m: Math.round(minDist) });
    }
  }

  return nearby.sort((a, b) => a.distance_m - b.distance_m);
}
