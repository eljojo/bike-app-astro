import type { PlaceData, NearbyPlace } from './proximity';
import { haversineM, PHOTO_NEAR_PLACE_M } from './proximity';
import { categoryEmoji } from './place-categories';
import { defaultLocale } from '../i18n/locale-utils';

interface MediaLocation {
  key: string;
  lat: number;
  lng: number;
}

/**
 * For places without a photo_key, find the nearest route media within
 * PHOTO_NEAR_PLACE_M and assign it as the place's photo_key.
 * Mutates the placeData array in place.
 */
export function assignPlacePhotosFromMedia(
  placeData: PlaceData[],
  allMediaLocations: MediaLocation[],
): void {
  if (allMediaLocations.length === 0) return;
  for (const place of placeData) {
    if (place.photo_key) continue;
    let bestKey: string | undefined;
    let bestDist = PHOTO_NEAR_PLACE_M;
    for (const media of allMediaLocations) {
      const dist = haversineM(place.lat, place.lng, media.lat, media.lng);
      if (dist < bestDist) {
        bestDist = dist;
        bestKey = media.key;
      }
    }
    if (bestKey) {
      place.photo_key = bestKey;
    }
  }
}

/**
 * Convert a collection of place entries (from `getCollection('places')`)
 * into the flat PlaceData[] used by proximity search and map components.
 *
 * Filters to published places only.
 */
export function toPlaceData(
  allPlaces: { id: string; data: { status: string; name: string; name_fr?: string; category: string; lat: number; lng: number; address?: string; website?: string; phone?: string; google_maps_url?: string; photo_key?: string; vibe?: string; good_for?: string[]; media?: Array<{ key: string; cover?: boolean }> } }[],
): PlaceData[] {
  return allPlaces
    .filter(p => p.data.status === 'published')
    .map(p => {
      // Prefer media cover photo over standalone photo_key
      const mediaCover = p.data.media?.find(m => m.cover)?.key
        || p.data.media?.[0]?.key;
      return {
        id: p.id,
        name: p.data.name,
        name_fr: p.data.name_fr,
        category: p.data.category,
        lat: p.data.lat,
        lng: p.data.lng,
        address: p.data.address,
        website: p.data.website,
        phone: p.data.phone,
        google_maps_url: p.data.google_maps_url,
        photo_key: mediaCover || p.data.photo_key,
        vibe: p.data.vibe,
        good_for: p.data.good_for,
      };
    });
}

/** Convert NearbyPlace[] into the format expected by map components. */
export function toMapPlaces(nearby: NearbyPlace[], locale?: string) {
  return nearby.map(p => ({
    name: (locale && locale !== defaultLocale() && p.name_fr) ? p.name_fr : p.name,
    emoji: categoryEmoji[p.category] || '\u{1F4CD}',
    lat: p.lat,
    lng: p.lng,
    google_maps_url: p.google_maps_url || `https://www.google.com/maps/?q=${p.lat},${p.lng}`,
    link: p.website,
    address: p.address,
    phone: p.phone,
    photo_key: p.photo_key,
    category: p.category,
  }));
}
