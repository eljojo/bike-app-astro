/**
 * Map factory — declarative setup for map components.
 *
 * Reads data attributes from a container element, creates a map session
 * with layers, wires controls and expandable mode. One function call
 * replaces ~100 lines of boilerplate per component.
 *
 * Browser-only — uses DOM APIs and MapLibre. Import only from <script> blocks.
 */
import { createMapSession, createPolylineLayer, createPhotoLayer, createPlaceLayer, createWaypointLayer, createElevationSyncLayer, createGpsLayer } from './layers';
import type { PolylineLayer } from './layers';
import type { MapLayer } from './layers/types';
import { buildPolylineFeature } from './map-init';
import { buildPlacePopup } from './map-helpers';
import { createExpandableMap } from './expandable-map';
import { loadToggleState } from '../../components/admin/MapControls';
import { render, h } from 'preact';
import MapControls from '../../components/admin/MapControls';
import type { MapStyleKey } from './map-style-switch';
import type maplibregl from 'maplibre-gl';
import polylineCodec from '@mapbox/polyline';

// ── Result ───────────────────────────────────────────────────────────

export interface MapFactoryResult {
  map: maplibregl.Map;
  session: ReturnType<typeof createMapSession>;
  polylineLayer: PolylineLayer;
  photoLayer: MapLayer | null;
  placeLayer: MapLayer | null;
  expandable: ReturnType<typeof createExpandableMap> | null;
}

// ── Options ──────────────────────────────────────────────────────────

export interface MapFactoryOptions {
  /** Use expandable card mode. Requires overlay + close button elements as siblings. */
  expandable?: boolean;
  /** Pre-created primary layer (e.g. geojsonLineLayer) instead of auto-creating from data-polylines. */
  primaryLayer?: MapLayer & { getBounds?: () => maplibregl.LngLatBounds | null };
  /** Include GPS layer with toggle in controls. */
  gps?: boolean;
  /** Default photo visibility (default: false). */
  defaultPhotos?: boolean;
  /** Default place visibility (default: false). */
  defaultPlaces?: boolean;
  /** Extra layers to add after the standard ones. */
  extraLayers?: MapLayer[];
  /** Callback after session.start(). */
  onReady?: (result: MapFactoryResult) => void;
  /** Custom popup builder for polylines. Receives raw polyline data, returns HTML string. */
  buildPopup?: (pl: Record<string, unknown>) => string;
}

// ── DOM data attribute parsing ───────────────────────────────────────

function parseJSON<T>(el: HTMLElement, attr: string, fallback: T): T {
  const raw = el.dataset[attr];
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function findSibling(el: HTMLElement, selector: string): HTMLElement | null {
  return el.parentElement?.querySelector(selector) ?? null;
}

function centerFromPolyline(encoded: string): [number, number] {
  const points = polylineCodec.decode(encoded);
  const mid = points[Math.floor(points.length / 2)];
  return [mid[0], mid[1]];
}

// ── Factory ──────────────────────────────────────────────────────────

/**
 * Set up a map from a container element's data attributes.
 *
 * Reads: data-polylines, data-photos, data-places, data-cdn-url,
 * data-waypoint-markers, data-center, data-zoom.
 *
 * Finds child elements: .expandable-map-gl, .expandable-map-controls,
 * .expandable-map-close, sibling .expandable-map-overlay.
 */
export function setupMapFromElement(container: HTMLElement, opts: MapFactoryOptions = {}): MapFactoryResult {
  const {
    expandable: isExpandable = false,
    primaryLayer,
    gps = false,
    defaultPhotos = false, defaultPlaces = false,
    extraLayers = [],
    onReady, buildPopup,
  } = opts;

  // Parse data from DOM
  const polylines = parseJSON<Record<string, unknown>[]>(container, 'polylines', []);
  const photos = parseJSON<Record<string, unknown>[]>(container, 'photos', []);
  const places = parseJSON<Record<string, unknown>[]>(container, 'places', []);
  const waypoints = parseJSON<Record<string, unknown>[]>(container, 'waypointMarkers', []);
  const cdnUrl = container.dataset.cdnUrl || '';
  const zoom = parseInt(container.dataset.zoom || '12');

  // Resolve center
  let center: [number, number] = parseJSON(container, 'center', null as unknown as [number, number]);
  if (!center && container.dataset.fallbackCenter) {
    center = parseJSON(container, 'fallbackCenter', [0, 0] as [number, number]);
  }
  if (!center && polylines.length > 0 && polylines[0].encoded) {
    center = centerFromPolyline(polylines[0].encoded as string);
  }
  if (!center) center = [0, 0];

  // Find child elements
  const glEl = container.querySelector<HTMLElement>('.expandable-map-gl') || container;
  const controlsEl = container.querySelector<HTMLElement>('.expandable-map-controls')
    || findSibling(container, '#route-map-controls')
    || container.parentElement?.querySelector<HTMLElement>('[id$="-controls"]');

  // Create primary layer
  let polylineLayer: PolylineLayer;
  if (primaryLayer) {
    polylineLayer = primaryLayer as unknown as PolylineLayer;
  } else {
    const popupFn = buildPopup || ((pl: Record<string, unknown>) => (pl.popup as string) || (pl.name as string) || '');
    const polylineData = polylines.map(pl => ({
      encoded: pl.encoded as string,
      popup: popupFn(pl),
      ...(pl.color ? { color: pl.color as string } : {}),
    }));
    polylineLayer = createPolylineLayer({ polylines: polylineData }) as PolylineLayer;
  }

  // Create optional layers
  // Layer factories expect specific types; DOM data is parsed as generic objects.
  // The JSON structure matches the expected types by convention (data attributes
  // are serialized from typed Astro props). Cast through unknown to satisfy both.
  const photoLayer = photos.length > 0
    ? createPhotoLayer({ photos: photos as unknown as Parameters<typeof createPhotoLayer>[0]['photos'], cdnUrl, defaultVisible: false })
    : null;
  const placeData = places.map(p => ({
    lat: p.lat as number, lng: p.lng as number, emoji: p.emoji as string,
    popup: buildPlacePopup(p as unknown as Parameters<typeof buildPlacePopup>[0], cdnUrl),
  }));
  const placeLayer = placeData.length > 0
    ? createPlaceLayer({ places: placeData, defaultVisible: false })
    : null;
  const waypointLayer = waypoints.length > 0
    ? createWaypointLayer({ waypoints: waypoints as unknown as Parameters<typeof createWaypointLayer>[0]['waypoints'] })
    : null;
  const gpsLayer = gps ? createGpsLayer() : null;

  // Build session
  const session = createMapSession({ el: glEl, center, zoom });
  session.use(polylineLayer);
  if (photoLayer) session.use(photoLayer);
  if (placeLayer) session.use(placeLayer);
  if (waypointLayer) session.use(waypointLayer);
  session.use(createElevationSyncLayer());
  if (gpsLayer) session.use(gpsLayer);
  for (const layer of extraLayers) session.use(layer);

  const { map } = session;
  let expandableResult: ReturnType<typeof createExpandableMap> | null = null;

  // Overlay visibility for expandable mode
  let wantsPhotos = loadToggleState('map-photos', defaultPhotos);
  let wantsPlaces = loadToggleState('map-places', defaultPlaces);

  function applyVisibility() {
    const isExp = expandableResult?.isExpanded() ?? !isExpandable; // non-expandable = always "expanded"
    if (photoLayer) photoLayer.setVisible!(map, isExp && wantsPhotos);
    if (placeLayer) placeLayer.setVisible!(map, isExp && wantsPlaces);
  }

  // Expandable mode
  if (isExpandable) {
    const overlay = findSibling(container, '.expandable-map-overlay');
    const closeBtn = container.querySelector<HTMLElement>('.expandable-map-close');
    if (overlay && closeBtn) {
      expandableResult = createExpandableMap(map, { card: container, glEl, overlay, closeBtn }, {
        getBounds: () => polylineLayer.getBounds?.() ?? null,
        onExpand: applyVisibility,
        onCollapse: applyVisibility,
      });
    }
  }

  const result: MapFactoryResult = { map, session, polylineLayer, photoLayer, placeLayer, expandable: expandableResult };

  session.start(() => onReady?.(result));

  // Controls
  map.on('load', () => {
    if (controlsEl) {
      render(h(MapControls, {
        hasPhotos: photos.length > 0,
        hasPlaces: places.length > 0,
        ...(isExpandable && { defaultPhotos: false, defaultPlaces: false }),
        onTogglePhotos: (v: boolean) => { wantsPhotos = v; applyVisibility(); },
        onTogglePlaces: (v: boolean) => { wantsPlaces = v; applyVisibility(); },
        ...(gpsLayer && { onToggleGps: (v: boolean) => gpsLayer.setVisible!(map, v) }),
        onToggleStyle: (key: MapStyleKey) => session.switchStyle(key, isExpandable ? undefined : () => {
          if (photoLayer) photoLayer.setVisible!(map, loadToggleState('map-photos', defaultPhotos));
          if (placeLayer) placeLayer.setVisible!(map, loadToggleState('map-places', defaultPlaces));
        }),
      }), controlsEl);
    }
  });

  return result;
}

// ── Variant helper ───────────────────────────────────────────────────

/**
 * Wire up variant switching from a container's data-polylines.
 * Listens for variant:change and swaps the polyline + fits bounds.
 */
export function wireVariantSwitch(
  map: maplibregl.Map,
  polylineLayer: PolylineLayer,
  container?: HTMLElement,
) {
  // Read all polylines from the container (includes all variants)
  const allPolylines = container
    ? parseJSON<{ encoded: string; name?: string; key?: string }[]>(container, 'polylines', [])
    : [];

  window.addEventListener('variant:change', ((e: CustomEvent<{ key: string }>) => {
    const key = e.detail.key;
    const idx = allPolylines.findIndex(p => p.key === key);
    if (idx >= 0) {
      const selected = allPolylines[idx];
      const feature = buildPolylineFeature(selected.encoded, selected.name || '');
      polylineLayer.updateData([feature]);
      const b = polylineLayer.getBounds?.();
      if (b && !b.isEmpty()) map.fitBounds(b, { padding: 20, animate: true });
    }
  }) as EventListener);
}
