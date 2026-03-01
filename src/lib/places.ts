import type { PlaceData } from './proximity';

/**
 * Convert a collection of place entries (from `getCollection('places')`)
 * into the flat PlaceData[] used by proximity search and map components.
 *
 * Filters to published places only.
 */
export function toPlaceData(
  allPlaces: { id: string; data: { status: string; name: string; category: string; lat: number; lng: number; address?: string; website?: string; phone?: string; google_maps_url?: string } }[],
): PlaceData[] {
  return allPlaces
    .filter(p => p.data.status === 'published')
    .map(p => ({
      id: p.id,
      name: p.data.name,
      category: p.data.category,
      lat: p.data.lat,
      lng: p.data.lng,
      address: p.data.address,
      website: p.data.website,
      phone: p.data.phone,
      google_maps_url: p.data.google_maps_url,
    }));
}
