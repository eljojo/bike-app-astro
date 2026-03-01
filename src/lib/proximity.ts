import { point, lineString } from '@turf/helpers';
import nearestPointOnLine from '@turf/nearest-point-on-line';
import type { GpxPoint } from './gpx';

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

export function findNearbyPlaces(trackPoints: GpxPoint[], places: PlaceData[]): NearbyPlace[] {
  if (trackPoints.length < 2) return [];

  const line = lineString(trackPoints.map(p => [p.lon, p.lat]));
  const nearby: NearbyPlace[] = [];

  for (const place of places) {
    const pt = point([place.lng, place.lat]);
    const snapped = nearestPointOnLine(line, pt, { units: 'meters' });
    const distance = snapped.properties.dist || Infinity;

    if (distance <= PROXIMITY_THRESHOLD_M) {
      nearby.push({ ...place, distance_m: Math.round(distance) });
    }
  }

  return nearby.sort((a, b) => a.distance_m - b.distance_m);
}
