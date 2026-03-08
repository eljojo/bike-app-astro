import type { APIContext } from 'astro';
import { authorize } from '../../lib/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';

export const prerender = false;

/** Extract CID (customer ID) from various Google Maps URL formats. */
export function extractCid(url: string): string | null {
  // Format: ...1s0x<hex>:0x<hex>...
  const hexMatch = url.match(/1s0x[\da-f]{16}:0x([\da-f]{16})/i);
  if (hexMatch) return BigInt(`0x${hexMatch[1]}`).toString();

  // Format: maps.google.com/?cid=<digits>
  const cidMatch = url.match(/maps\.google\.com\/\?cid=(\d+)/);
  if (cidMatch) return cidMatch[1];

  // Format: ftid=0x<hex>:0x<hex>
  const ftidMatch = url.match(/ftid=0x[\da-f]{16}:0x([\da-f]{16})/i);
  if (ftidMatch) return BigInt(`0x${ftidMatch[1]}`).toString();

  return null;
}

/** Extract @lat,lng from a Google Maps URL. */
export function extractCoordinates(url: string): { lat: number; lng: number } | null {
  const match = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (!match) return null;
  return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
}

/** Follow redirects to get the final URL (for short goo.gl / maps.app.goo.gl links). */
async function fetchFinalUrl(url: string, limit = 3): Promise<string | null> {
  if (limit === 0 || !url.startsWith('http')) return null;
  const res = await fetch(url, { redirect: 'manual' });
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location');
    if (location) return fetchFinalUrl(location, limit - 1);
  }
  return res.url || url;
}

const GOOGLE_TYPE_TO_CATEGORY: Record<string, string> = {
  cafe: 'cafe',
  bakery: 'cafe',
  restaurant: 'restaurant',
  meal_takeaway: 'restaurant',
  meal_delivery: 'restaurant',
  bar: 'beer',
  night_club: 'beer',
  park: 'park',
  campground: 'park',
  bicycle_store: 'bike-shop',
  grocery_or_supermarket: 'food',
  supermarket: 'food',
  convenience_store: 'food',
  lodging: 'motel',
  hotel: 'motel',
  motel: 'motel',
  parking: 'parking',
  transit_station: 'meeting-point',
  bus_station: 'meeting-point',
  train_station: 'meeting-point',
  tourist_attraction: 'something-interesting',
  museum: 'something-interesting',
  art_gallery: 'something-interesting',
  natural_feature: 'lookout',
  pizza_restaurant: 'pizza',
};

/** Map Google Places API types to app categories. Returns the first match or null. */
export function mapGoogleTypeToCategory(types: string[]): string | null {
  for (const type of types) {
    if (GOOGLE_TYPE_TO_CATEGORY[type]) return GOOGLE_TYPE_TO_CATEGORY[type];
  }
  return null;
}

interface PlaceResult {
  name: string;
  lat: number;
  lng: number;
  address?: string;
  phone?: string;
  website?: string;
  google_maps_url?: string;
  category?: string;
}

async function fetchPlaceFromText(query: string, apiKey: string): Promise<string | null> {
  const params = new URLSearchParams({
    input: query,
    inputtype: 'textquery',
    language: 'en',
    key: apiKey,
  });
  const res = await fetch(`https://maps.googleapis.com/maps/api/place/findplacefromtext/json?${params}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.candidates?.[0]?.place_id ?? null;
}

async function fetchPlaceDetails(id: string, apiKey: string, isCid = false): Promise<PlaceResult | null> {
  const idParam = isCid ? 'cid' : 'place_id';
  const params = new URLSearchParams({
    [idParam]: id,
    key: apiKey,
    fields: 'url,name,geometry,formatted_address,formatted_phone_number,website,types',
    language: 'en',
  });
  const res = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?${params}`);
  if (!res.ok) return null;
  const data = await res.json();
  if (data.status !== 'OK' || !data.result?.name) return null;

  return {
    name: data.result.name,
    lat: data.result.geometry.location.lat,
    lng: data.result.geometry.location.lng,
    address: data.result.formatted_address,
    phone: data.result.formatted_phone_number,
    website: data.result.website,
    google_maps_url: data.result.url,
    category: mapGoogleTypeToCategory(data.result.types || []) ?? undefined,
  };
}

async function searchPlace(query: string, apiKey: string): Promise<PlaceResult | null> {
  // Try extracting metadata from URL first
  if (query.startsWith('http')) {
    const cid = extractCid(query);
    if (cid) {
      const details = await fetchPlaceDetails(cid, apiKey, true);
      if (details) return details;
    }

    // Try following redirects for short URLs
    if (!query.includes('@') && !cid) {
      const finalUrl = await fetchFinalUrl(query);
      if (finalUrl && finalUrl !== query) {
        const cidFromFinal = extractCid(finalUrl);
        if (cidFromFinal) {
          const details = await fetchPlaceDetails(cidFromFinal, apiKey, true);
          if (details) return details;
        }
      }
    }

    // Extract coordinates as fallback (no place details)
    const coords = extractCoordinates(query);
    if (coords) return { name: '', ...coords };
  }

  // Text search fallback
  const placeId = await fetchPlaceFromText(query, apiKey);
  if (!placeId) return null;
  return fetchPlaceDetails(placeId, apiKey);
}

export async function POST({ request, locals }: APIContext) {
  const user = authorize(locals, 'edit-content');
  if (user instanceof Response) return user;

  const body = await request.json();
  const query = body?.query;
  if (!query || typeof query !== 'string') {
    return jsonError('Missing query', 400);
  }

  const { env } = await import('../../lib/env');
  const apiKey = env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return jsonError('GOOGLE_PLACES_API_KEY is not configured', 500);
  }

  const result = await searchPlace(query.trim(), apiKey);
  if (!result) {
    return jsonError('No place found for that query', 404);
  }

  return jsonResponse(result as unknown as Record<string, unknown>);
}
