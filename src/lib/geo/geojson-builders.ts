/**
 * Pure GeoJSON builders for places and photo tiles.
 *
 * Extracted from build-data-plugin.ts to keep the plugin focused on
 * orchestration and I/O. These functions are pure (no fs, no side effects)
 * and tested directly.
 */
import type { FeatureCollection, Feature } from 'geojson';
import type { TileManifestEntry } from '../maps/tile-types';
import { categoryEmoji } from './place-categories';
import { haversineM, PHOTO_NEAR_PLACE_M } from './proximity';

// --- Places GeoJSON ---

export interface PlaceGeoInput {
  name: string;
  category: string;
  lat: number;
  lng: number;
  status?: string;
  name_fr?: string;
  address?: string;
  website?: string;
  phone?: string;
  google_maps_url?: string;
  photo_key?: string;
  media?: Array<{ key: string; cover?: boolean }>;
  organizer_name?: string;
  organizer_url?: string;
}

export interface MediaLocationInput {
  key: string;
  lat: number;
  lng: number;
}

export function buildPlacesGeoJSON(
  places: PlaceGeoInput[],
  mediaLocations: MediaLocationInput[],
): FeatureCollection {
  const published = places.filter(p => !p.status || p.status === 'published');

  const features: Feature[] = published.map(place => {
    // Resolve photo_key: media cover > first media > standalone photo_key
    const mediaCover = place.media?.find(m => m.cover)?.key || place.media?.[0]?.key;
    let photoKey = mediaCover || place.photo_key;

    // Auto-assign from nearest geolocated media within threshold
    if (!photoKey) {
      let bestKey: string | undefined;
      let bestDist = PHOTO_NEAR_PLACE_M;
      for (const m of mediaLocations) {
        const dist = haversineM(m.lat, m.lng, place.lat, place.lng);
        if (dist < bestDist) {
          bestDist = dist;
          bestKey = m.key;
        }
      }
      photoKey = bestKey;
    }

    const properties: Record<string, unknown> = {
      name: place.name,
      emoji: categoryEmoji[place.category] || '📍',
      category: place.category,
    };

    if (place.name_fr) properties.name_fr = place.name_fr;
    if (place.address) properties.address = place.address;
    if (place.phone) properties.phone = place.phone;
    if (place.website) properties.link = place.website;
    if (place.google_maps_url) properties.google_maps_url = place.google_maps_url;
    if (photoKey) properties.photo_key = photoKey;
    if (place.organizer_name) properties.organizer_name = place.organizer_name;
    if (place.organizer_url) properties.organizer_url = place.organizer_url;

    return {
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [place.lng, place.lat],
      },
      properties,
    };
  });

  return { type: 'FeatureCollection', features };
}

// --- Photo tiles ---

export interface PhotoTileInput {
  key: string;
  lat: number;
  lng: number;
  routeSlug: string;
  caption?: string;
  width?: number;
  height?: number;
  type?: string;
}

export interface PhotoRouteInfo {
  name: string;
  url: string;
}

export interface PhotoTileData {
  features: Feature[];
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export function buildPhotoTiles(
  mediaLocations: PhotoTileInput[],
  routeInfo: Map<string, PhotoRouteInfo>,
): { tiles: Map<string, PhotoTileData>; manifest: TileManifestEntry[] } {
  const tiles = new Map<string, PhotoTileData>();

  // Filter to photos only (exclude videos and other types)
  const photos = mediaLocations.filter(m => !m.type || m.type === 'photo');

  for (const photo of photos) {
    const tileId = `${Math.floor(photo.lat)}_${Math.floor(photo.lng)}`;
    const route = photo.routeSlug !== '__parked' ? routeInfo.get(photo.routeSlug) : undefined;

    const feature: Feature = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [photo.lng, photo.lat],
      },
      properties: {
        key: photo.key,
        _fid: photo.key,
        caption: photo.caption || '',
        width: photo.width || 0,
        height: photo.height || 0,
        routeName: route?.name || '',
        routeUrl: route?.url || '',
      },
    };

    let tile = tiles.get(tileId);
    if (!tile) {
      tile = {
        features: [],
        minLng: Infinity,
        minLat: Infinity,
        maxLng: -Infinity,
        maxLat: -Infinity,
      };
      tiles.set(tileId, tile);
    }
    tile.features.push(feature);

    if (photo.lng < tile.minLng) tile.minLng = photo.lng;
    if (photo.lat < tile.minLat) tile.minLat = photo.lat;
    if (photo.lng > tile.maxLng) tile.maxLng = photo.lng;
    if (photo.lat > tile.maxLat) tile.maxLat = photo.lat;
  }

  // Build manifest, sorted alphabetically by tile ID
  const manifest: TileManifestEntry[] = [...tiles.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, tile]) => ({
      id,
      bounds: [tile.minLng, tile.minLat, tile.maxLng, tile.maxLat] as [number, number, number, number],
      featureCount: tile.features.length,
      file: `tile-${id}.geojson`,
    }));

  return { tiles, manifest };
}
