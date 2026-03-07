import { findNearbyPhotos } from '../lib/photo-proximity';

export interface PhotoLocation {
  key: string;
  lat: number;
  lng: number;
  routeSlug: string;
  caption?: string;
  width?: number;
  height?: number;
}

export interface ParkedPhoto {
  key: string;
  lat: number;
  lng: number;
  caption?: string;
  width?: number;
  height?: number;
  uploaded_by?: string;
  captured_at?: string;
}

/**
 * Build a flat list of all geolocated photos across all routes.
 * Parked photos are merged with routeSlug '__parked'.
 * Used as a virtual module for cross-route photo suggestions in the admin editor.
 */
export function buildPhotoLocations(
  routeData: Record<string, { media: Array<{ key: string; lat?: number; lng?: number; caption?: string; width?: number; height?: number }> }>,
  parkedPhotos: ParkedPhoto[] = [],
): PhotoLocation[] {
  const photos: PhotoLocation[] = [];

  for (const [routeSlug, route] of Object.entries(routeData)) {
    for (const m of route.media) {
      // Admin detail media is already filtered to photos only (no type field)
      if (m.lat != null && m.lng != null) {
        photos.push({
          key: m.key,
          lat: m.lat,
          lng: m.lng,
          routeSlug,
          caption: m.caption,
          width: m.width,
          height: m.height,
        });
      }
    }
  }

  for (const p of parkedPhotos) {
    photos.push({
      key: p.key,
      lat: p.lat,
      lng: p.lng,
      routeSlug: '__parked',
      caption: p.caption,
      width: p.width,
      height: p.height,
    });
  }

  return photos;
}

/**
 * Pre-compute nearby photos for each route at build time.
 * Maps route slug → array of photos from other routes within 200m of its track.
 */
export function buildNearbyPhotosMap(
  allPhotos: PhotoLocation[],
  routeTracks: Record<string, Array<{ lat: number; lng: number }>>,
): Record<string, PhotoLocation[]> {
  const result: Record<string, PhotoLocation[]> = {};

  for (const [slug, trackPoints] of Object.entries(routeTracks)) {
    const nearby = findNearbyPhotos(trackPoints, allPhotos, slug);
    if (nearby.length > 0) {
      result[slug] = nearby;
    }
  }

  return result;
}
