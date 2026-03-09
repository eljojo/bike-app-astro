import type { PlaceData, NearbyPlace } from './proximity';
import { categoryEmoji } from './place-categories';
import { defaultLocale } from './locale-utils';

/**
 * Convert a collection of place entries (from `getCollection('places')`)
 * into the flat PlaceData[] used by proximity search and map components.
 *
 * Filters to published places only.
 */
export function toPlaceData(
  allPlaces: { id: string; data: { status: string; name: string; name_fr?: string; category: string; lat: number; lng: number; address?: string; website?: string; phone?: string; google_maps_url?: string; photo_key?: string } }[],
): PlaceData[] {
  return allPlaces
    .filter(p => p.data.status === 'published')
    .map(p => ({
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
      photo_key: p.data.photo_key,
    }));
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
