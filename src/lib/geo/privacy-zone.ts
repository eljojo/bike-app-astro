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

/** Default radius for dynamic privacy zones (roughly 4–6 city blocks). */
const DEFAULT_DYNAMIC_RADIUS_M = 500;

/** Maximum jitter added/subtracted from radius to prevent triangulation. */
const DEFAULT_JITTER_M = 150;

function isInsideZone(lat: number, lng: number, zone: PrivacyZoneConfig): boolean {
  return haversineM(lat, lng, zone.lat, zone.lng) <= zone.radius_m;
}

function isInsideAnyZone(lat: number, lng: number, zones: PrivacyZoneConfig[]): boolean {
  return zones.some((z) => isInsideZone(lat, lng, z));
}

/**
 * Simple seeded PRNG — returns a value in [0, 1) from a string seed.
 * Uses FNV-1a hash to produce a deterministic number per ride so
 * the jittered radius is stable across builds but varies per ride.
 */
function seededRandom(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * Compute a jittered radius for a dynamic privacy zone.
 * The seed makes the jitter deterministic per ride (stable across rebuilds)
 * but different per ride (prevents triangulation from multiple rides).
 */
function jitteredRadius(baseRadius: number, jitter: number, seed: string): number {
  const r = seededRandom(seed);
  return baseRadius + (r * 2 - 1) * jitter;
}

/**
 * Build dynamic privacy zones from a ride's track points.
 *
 * Creates a zone around the ride's start point (and end point if it differs
 * significantly from start). The radius is jittered per ride to prevent
 * reverse-engineering the exact home location from multiple rides.
 *
 * This catches: the first/last stretch of a ride, and any mid-ride pass
 * back through the zone (e.g., forgot something and went home to grab it).
 */
export function computeDynamicZones(
  points: { lat: number; lng: number }[],
  seed: string,
  options?: { radius_m?: number; jitter_m?: number },
): PrivacyZoneConfig[] {
  if (points.length === 0) return [];

  const baseRadius = options?.radius_m ?? DEFAULT_DYNAMIC_RADIUS_M;
  const jitter = options?.jitter_m ?? DEFAULT_JITTER_M;

  const start = points[0];
  const end = points[points.length - 1];

  const startRadius = jitteredRadius(baseRadius, jitter, `start:${seed}`);
  const zones: PrivacyZoneConfig[] = [
    { lat: start.lat, lng: start.lng, radius_m: startRadius },
  ];

  // Only add an end zone if the end point is far enough from start that
  // a separate zone would cover additional area (non-round-trip rides).
  const distStartEnd = haversineM(start.lat, start.lng, end.lat, end.lng);
  if (distStartEnd > baseRadius * 0.5) {
    const endRadius = jitteredRadius(baseRadius, jitter, `end:${seed}`);
    zones.push({ lat: end.lat, lng: end.lng, radius_m: endRadius });
  }

  return zones;
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
 * Remove all track points that fall inside any of the given privacy zones.
 */
export function filterPrivacyZones<T extends TrackPoint>(
  points: T[],
  zones: PrivacyZoneConfig[],
): T[] {
  if (zones.length === 0) return points;
  if (zones.length === 1) return filterPrivacyZone(points, zones[0]);
  return points.filter((p) => !isInsideAnyZone(p.lat, p.lng, zones));
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

/**
 * Strip lat/lng from media that fall inside any of the given privacy zones.
 * Returns new array (does not mutate input).
 */
export function stripPrivacyMediaMulti<T extends { lat?: number; lng?: number }>(
  photos: T[],
  zones: PrivacyZoneConfig[],
): T[] {
  if (zones.length === 0) return photos;
  if (zones.length === 1) return stripPrivacyMedia(photos, zones[0]);
  return photos.map((p) => {
    if (p.lat != null && p.lng != null && isInsideAnyZone(p.lat, p.lng, zones)) {
      const { lat: _lat, lng: _lng, ...rest } = p;
      return rest as T;
    }
    return p;
  });
}
