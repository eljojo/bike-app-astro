export interface PhotoLocation {
  key: string;
  lat: number;
  lng: number;
  routeSlug: string;
  caption?: string;
  width?: number;
  height?: number;
}

/**
 * Build a flat list of all geolocated photos across all routes.
 * Used as a virtual module for cross-route photo suggestions in the admin editor.
 */
export function buildPhotoLocations(
  routeData: Record<string, { media: Array<{ type: string; key: string; lat?: number; lng?: number; caption?: string; width?: number; height?: number }> }>,
): PhotoLocation[] {
  const photos: PhotoLocation[] = [];

  for (const [routeSlug, route] of Object.entries(routeData)) {
    for (const m of route.media) {
      if (m.type === 'photo' && m.lat != null && m.lng != null) {
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

  return photos;
}
