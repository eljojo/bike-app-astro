import { findNearbyMedia } from '../lib/geo/media-proximity';

export interface MediaLocation {
  key: string;
  lat: number;
  lng: number;
  routeSlug: string;
  caption?: string;
  width?: number;
  height?: number;
  type?: 'photo' | 'video';
}

export interface ParkedMedia {
  key: string;
  lat: number;
  lng: number;
  caption?: string;
  width?: number;
  height?: number;
  uploaded_by?: string;
  captured_at?: string;
  type?: 'photo' | 'video';
}

/**
 * Build a flat list of all geolocated media across all routes.
 * Parked media are merged with routeSlug '__parked'.
 * Used as a virtual module for cross-route media suggestions in the admin editor.
 */
export function buildMediaLocations(
  routeData: Record<string, { media: Array<{ key: string; lat?: number; lng?: number; caption?: string; width?: number; height?: number; type?: string }> }>,
  parkedMedia: ParkedMedia[] = [],
): MediaLocation[] {
  const locations: MediaLocation[] = [];

  for (const [routeSlug, route] of Object.entries(routeData)) {
    for (const m of route.media) {
      if (m.lat != null && m.lng != null) {
        locations.push({
          key: m.key,
          lat: m.lat,
          lng: m.lng,
          routeSlug,
          caption: m.caption,
          width: m.width,
          height: m.height,
          ...(m.type === 'video' && { type: 'video' as const }),
        });
      }
    }
  }

  for (const p of parkedMedia) {
    locations.push({
      key: p.key,
      lat: p.lat,
      lng: p.lng,
      routeSlug: '__parked',
      caption: p.caption,
      width: p.width,
      height: p.height,
      ...(p.type === 'video' && { type: 'video' as const }),
    });
  }

  return locations;
}

/**
 * Pre-compute nearby media for each route at build time.
 * Maps route slug to array of media from other routes within 200m of its track.
 */
export function buildNearbyMediaMap(
  allMedia: MediaLocation[],
  routeTracks: Record<string, Array<{ lat: number; lng: number }>>,
): Record<string, MediaLocation[]> {
  const result: Record<string, MediaLocation[]> = {};

  for (const [slug, trackPoints] of Object.entries(routeTracks)) {
    const nearby = findNearbyMedia(trackPoints, allMedia, slug);
    if (nearby.length > 0) {
      result[slug] = nearby;
    }
  }

  return result;
}
