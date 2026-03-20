import { buildImageUrl } from '../media/image-service';
import polylineCodec from '@mapbox/polyline';
import { haversineM, PLACE_NEAR_ROUTE_M } from '../geo/proximity';

// --- Category filtering for ?category= query param on /map ---

interface FilterablePlace {
  category: string;
  lat: number;
  lng: number;
}

interface FilterableRoute {
  polyline: string;
}

/**
 * Filter map data to only show places of a given category and routes
 * that pass within PLACE_NEAR_ROUTE_M of those places.
 */
export function filterMapByCategory<P extends FilterablePlace, R extends FilterableRoute>(
  places: P[],
  routes: R[],
  category: string,
): { places: P[]; routes: R[] } {
  const filteredPlaces = places.filter(p => p.category === category);

  const filteredRoutes = routes.filter(r => {
    const points = polylineCodec.decode(r.polyline);
    for (const place of filteredPlaces) {
      for (const [lat, lng] of points) {
        if (haversineM(lat, lng, place.lat, place.lng) <= PLACE_NEAR_ROUTE_M) return true;
      }
    }
    return false;
  });

  return { places: filteredPlaces, routes: filteredRoutes };
}

interface PlacePopupData {
  name: string;
  description?: string;
  link?: string;
  google_maps_url?: string;
  address?: string;
  phone?: string;
  photo_key?: string;
  category?: string;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Marker type for pre-escaped HTML that should not be double-escaped. */
const RAW = Symbol('raw');

interface RawHtml {
  [RAW]: true;
  value: string;
}

/** Mark a string as pre-escaped HTML (will not be escaped by html``). */
export function raw(value: string): RawHtml {
  return { [RAW]: true, value };
}

/**
 * Tagged template literal that auto-escapes all interpolated values.
 * Use raw() to pass through pre-escaped HTML.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  let result = strings[0];
  for (let i = 0; i < values.length; i++) {
    const val = values[i];
    if (val != null && typeof val === 'object' && RAW in val) {
      result += (val as RawHtml).value;
    } else if (val != null) {
      result += escapeHtml(String(val));
    }
    result += strings[i + 1];
  }
  return result;
}

export function buildPlacePopup(place: PlacePopupData, cdnUrl?: string): string {
  let popup = '<div class="place-popup">';
  if (place.photo_key && cdnUrl) {
    popup += html`<img class="place-popup-photo" src="${raw(buildImageUrl(cdnUrl, place.photo_key, { width: 280, height: 160, fit: 'cover' }))}" alt="" />`;
  }
  popup += html`<strong>${place.name}</strong>`;
  if (place.address) popup += html`<div class="place-popup-address">${place.address}</div>`;
  if (place.phone) popup += html`<div class="place-popup-phone">${place.phone}</div>`;
  const links: string[] = [];
  if (place.link) links.push(html`<a href="${place.link}" target="_blank" rel="noopener">Website</a>`);
  if (place.google_maps_url) links.push(html`<a href="${place.google_maps_url}" target="_blank" rel="noopener">Google Maps</a>`);
  if (links.length) popup += `<div class="place-popup-links">${links.join(' · ')}</div>`;
  popup += '</div>';
  return popup;
}

export interface WaypointPopupData {
  label: string;
  type: string;
  distance_km?: number;
  opening?: string;
  closing?: string;
  note?: string;
  description?: string;
  address?: string;
  photo_key?: string;
  website?: string;
  google_maps_url?: string;
}

const TYPE_LABELS: Record<string, string> = {
  checkpoint: 'Checkpoint',
  danger: 'Danger',
  poi: 'Point of interest',
};

export function buildWaypointPopup(wp: WaypointPopupData, cdnUrl?: string): string {
  let popup = '<div class="waypoint-popup">';

  if (wp.photo_key && cdnUrl) {
    popup += html`<img class="waypoint-popup-photo" src="${raw(buildImageUrl(cdnUrl, wp.photo_key, { width: 280, height: 160, fit: 'cover' }))}" alt="" />`;
  }

  popup += html`<strong>${wp.label}</strong>`;

  // Type badge + distance
  const typeParts: string[] = [TYPE_LABELS[wp.type] || wp.type];
  if (wp.distance_km != null) typeParts.push(`${wp.distance_km} km`);
  popup += html`<div class="waypoint-popup-meta">${raw(typeParts.join(' \u00b7 '))}</div>`;

  // Opening/closing (checkpoints only)
  if (wp.type === 'checkpoint' && (wp.opening || wp.closing)) {
    const times = [wp.opening, wp.closing].filter(Boolean).join(' \u2014 ');
    popup += html`<div class="waypoint-popup-times">${times}</div>`;
  }

  if (wp.note) {
    popup += html`<div class="waypoint-popup-note">${wp.note}</div>`;
  }

  if (wp.description) {
    popup += html`<div class="waypoint-popup-description">${wp.description}</div>`;
  }

  if (wp.address) {
    popup += html`<div class="waypoint-popup-address">${wp.address}</div>`;
  }

  const links: string[] = [];
  if (wp.website) links.push(html`<a href="${wp.website}" target="_blank" rel="noopener">Website</a>`);
  if (wp.google_maps_url) links.push(html`<a href="${wp.google_maps_url}" target="_blank" rel="noopener">Google Maps</a>`);
  if (links.length) popup += `<div class="waypoint-popup-links">${links.join(' \u00b7 ')}</div>`;

  popup += '</div>';
  return popup;
}
