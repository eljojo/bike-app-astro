import { buildImageUrl } from '../media/image-service';
import polylineCodec from '@mapbox/polyline';
import { haversineM, PLACE_NEAR_ROUTE_M } from '../geo/proximity';
import type { Segment } from './tile-types';

/**
 * Yield every [lng, lat] coordinate from a collection of GeoJSON features.
 * Handles LineString and MultiLineString geometries; other types are skipped.
 * Shared by bounds/midpoint computations across multiple map modules.
 */
export function* iterLineCoords(
  features: Iterable<GeoJSON.Feature>,
): Generator<[number, number]> {
  for (const f of features) {
    const geom = f.geometry;
    if (geom.type === 'LineString') {
      yield* (geom as GeoJSON.LineString).coordinates as [number, number][];
    } else if (geom.type === 'MultiLineString') {
      for (const line of (geom as GeoJSON.MultiLineString).coordinates) {
        yield* line as [number, number][];
      }
    }
  }
}

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
  organizer_name?: string;
  organizer_url?: string;
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
  if (place.organizer_url) {
    popup += html`<div class="place-popup-organizer"><a href="${place.organizer_url}">${place.organizer_name || place.name}</a></div>`;
  }
  if (place.address) popup += html`<div class="place-popup-address">${place.address}</div>`;
  if (place.phone) popup += html`<div class="place-popup-phone">${place.phone}</div>`;
  const links: string[] = [];
  if (place.link) links.push(html`<a href="${place.link}" target="_blank" rel="noopener">Website</a>`);
  if (place.google_maps_url) links.push(html`<a href="${place.google_maps_url}" target="_blank" rel="noopener">Google Maps</a>`);
  if (links.length) popup += `<div class="place-popup-links">${links.join(' · ')}</div>`;
  popup += '</div>';
  return popup;
}

// --- Path popup (shared between paths-browse-map and tile-path-layer) ---

export interface PathPopupData {
  name: string;
  url?: string;
  length_km?: number;
  surface?: string;
  path_type?: string;
  vibe?: string;
  network?: string;
  networkUrl?: string;
  /**
   * Optional resolved segment for per-click context. When set and the
   * segment has a distinct name from the entry, `buildPathPopup` renders
   * Mode B (segment-first, entry as parent context). When undefined —
   * or when the segment is unnamed or shares its name with the entry —
   * the popup falls through to Mode A, which is the existing rendering
   * used everywhere before Phase 1 of the pageless-path-segments plan.
   */
  segment?: Segment;
}

/**
 * Format a `surface_mix` array for popup display. Returns strings like:
 *   "asphalt"                            (single value)
 *   "9 km asphalt · 0.1 km gravel"       (multi-value)
 * Input is expected to be sorted descending by km (per `Segment.surface_mix`
 * invariant). Km values are rendered with 1dp precision, with a trailing
 * `.0` stripped so whole-number kilometres read naturally.
 */
function formatSurfaceMix(mix: Array<{ value: string; km: number }>): string {
  if (mix.length === 0) return '';
  if (mix.length === 1) return mix[0].value;
  return mix.map(m => `${formatKm(m.km)} km ${m.value}`).join(' \u00b7 ');
}

function formatKm(km: number): string {
  const s = km.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/** Human-readable label for a `path_type` value. Unknown types pass through as-is. */
function formatPathType(pathType: string | undefined): string {
  if (!pathType) return '';
  switch (pathType) {
    case 'mup': return 'multi-use pathway';
    case 'bike-lane': return 'bike lane';
    case 'separated-lane': return 'separated bike lane';
    case 'paved-shoulder': return 'paved shoulder';
    case 'trail': return 'trail';
    case 'mtb-trail': return 'mountain bike trail';
    default: return pathType;
  }
}

export function buildPathPopup(data: PathPopupData, labels?: { viewDetails?: string }): string {
  // Mode B: the resolved segment has a distinct name from the entry.
  // Render segment-first with the parent entry shown as context below.
  // Deliberately does NOT include the entry's aggregate `surface` —
  // aggregate surface is misleading for heterogeneous long trails,
  // which is the whole reason Mode B exists.
  const seg = data.segment;
  if (seg !== undefined && seg.name !== undefined && seg.name !== data.name) {
    const surfaceLine = formatSurfaceMix(seg.surface_mix);
    const typeLabel = formatPathType(data.path_type);
    const viewDetailsLabel = labels?.viewDetails ?? 'View details';

    let popup = '<div class="path-popup path-popup-segment">';
    popup += html`<strong class="path-popup-segment-name">${seg.name}</strong>`;
    if (surfaceLine) {
      popup += html`<div class="path-popup-segment-surface">${surfaceLine}</div>`;
    }
    popup += '<hr class="path-popup-divider" />';
    popup += html`<div class="path-popup-parent">part of <strong>${data.name}</strong></div>`;
    const parentMeta: string[] = [];
    if (typeLabel) parentMeta.push(html`<span class="path-popup-parent-type" data-path-type="${data.path_type ?? ''}">${typeLabel}</span>`);
    if (data.url) parentMeta.push(html`<a href="${data.url}" class="path-popup-link">${viewDetailsLabel} \u2192</a>`);
    if (parentMeta.length > 0) {
      popup += `<div class="path-popup-parent-meta">${parentMeta.join(' \u00b7 ')}</div>`;
    }
    popup += '</div>';
    return popup;
  }

  // Mode A: the existing rendering — unchanged.
  const meta: string[] = [];
  if (data.length_km) meta.push(`${data.length_km} km`);
  if (data.surface) meta.push(escapeHtml(data.surface));
  if (data.path_type) meta.push(escapeHtml(data.path_type));

  let popup = '<div class="path-popup">';
  popup += data.url
    ? html`<strong class="path-popup-name"><a href="${data.url}">${data.name}</a></strong>`
    : html`<strong class="path-popup-name">${data.name}</strong>`;

  if (data.network) {
    popup += data.networkUrl
      ? html`<div class="path-popup-network"><a href="${data.networkUrl}" class="path-popup-network-link">${data.network}</a></div>`
      : html`<div class="path-popup-network">${data.network}</div>`;
  }
  if (meta.length > 0) {
    popup += `<div class="path-popup-meta">${meta.join(' \u00b7 ')}</div>`;
  }
  if (data.vibe) {
    popup += html`<div class="path-popup-vibe">${data.vibe}</div>`;
  }
  if (data.url) {
    popup += html`<a href="${data.url}" class="path-popup-link">${labels?.viewDetails ?? 'View details'} \u2192</a>`;
  }
  popup += '</div>';
  return popup;
}

/**
 * Build the inner content markup for the paths-browse map path card.
 * Takes the same data shape as buildPathPopup. The surrounding card
 * container + close button are created by paths-browse-map.ts.
 *
 * Compact two-row layout: primary row is name + meta on a single line,
 * optional secondary row carries network + vibe. Clicking the name
 * navigates to the detail page — no separate "view details" link so
 * the card stays short enough to see the map behind.
 */
export function buildPathCardContent(data: PathPopupData): string {
  const meta: string[] = [];
  if (data.length_km) meta.push(`${data.length_km} km`);
  if (data.surface) meta.push(escapeHtml(data.surface));
  if (data.path_type) meta.push(escapeHtml(data.path_type));

  const nameEl = data.url
    ? html`<a class="map-path-card-name" href="${data.url}">${data.name}</a>`
    : html`<span class="map-path-card-name">${data.name}</span>`;

  const metaEl = meta.length > 0
    ? `<span class="map-path-card-meta">${meta.join(' \u00b7 ')}</span>`
    : '';

  const secondary: string[] = [];
  if (data.network) {
    secondary.push(data.networkUrl
      ? html`<a href="${data.networkUrl}">${data.network}</a>`
      : html`<span>${data.network}</span>`);
  }
  if (data.vibe) {
    secondary.push(html`<span>${data.vibe}</span>`);
  }

  let body = `<div class="map-path-card-primary">${nameEl}${metaEl}</div>`;
  if (secondary.length > 0) {
    body += `<div class="map-path-card-secondary">${secondary.join('<span class="map-path-card-sep">·</span>')}</div>`;
  }
  return body;
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
