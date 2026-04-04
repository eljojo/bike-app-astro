/**
 * Map factory — declarative setup for map components.
 *
 * Replaces the repeated boilerplate of: parse data → create session →
 * add layers → start → wire controls → wire expandable → wire variants.
 *
 * Browser-only — uses DOM APIs and MapLibre. Import only from <script> blocks.
 */
import { createMapSession, createPolylineLayer, createPhotoLayer, createPlaceLayer, createWaypointLayer, createElevationSyncLayer } from './layers';
import type { PolylineLayer } from './layers';
import type { MapLayer } from './layers/types';
import { buildPolylineFeature } from './map-init';
import { createExpandableMap } from './expandable-map';
import { loadToggleState } from '../../components/admin/MapControls';
import { render, h } from 'preact';
import MapControls from '../../components/admin/MapControls';
import type { MapStyleKey } from './map-style-switch';
import type maplibregl from 'maplibre-gl';

// ── Input types ──────────────────────────────────────────────────────

export interface MapPolyline {
  encoded: string;
  popup?: string;
  color?: string;
  name?: string;
  key?: string;
}

export interface MapPhoto {
  key: string;
  lat: number;
  lng: number;
  caption?: string;
  width?: number;
  height?: number;
  index: number;
  routeName?: string;
  routeUrl?: string;
}

export interface MapPlace {
  lat: number;
  lng: number;
  emoji: string;
  popup: string;
}

export interface MapWaypoint {
  lat: number;
  lng: number;
  type: string;
  label: string;
  popup: string;
  [k: string]: unknown;
}

export interface ExpandableElements {
  card: HTMLElement;
  glEl: HTMLElement;
  overlay: HTMLElement;
  closeBtn: HTMLElement;
}

export interface MapFactoryOptions {
  /** The map GL container element */
  el: HTMLElement;
  center: [number, number];
  zoom?: number;

  // ── Layers (all optional) ──
  polylines?: MapPolyline[];
  photos?: MapPhoto[];
  places?: MapPlace[];
  waypoints?: MapWaypoint[];
  cdnUrl?: string;

  /** Extra layers to add after the standard ones */
  extraLayers?: MapLayer[];

  /** Default visibility for photos (default: false) */
  defaultPhotos?: boolean;
  /** Default visibility for places (default: false) */
  defaultPlaces?: boolean;

  // ── Controls ──
  /** Element to render MapControls into. Omit to skip controls. */
  controlsEl?: HTMLElement | null;

  // ── Expandable mode ──
  /** Elements for expandable card mode. Omit for non-expandable maps. */
  expandable?: ExpandableElements;

  /** Callback after session.start() */
  onReady?: (ctx: MapFactoryResult) => void;

  /** Callback when expand/collapse changes overlay visibility */
  onExpandChange?: (expanded: boolean) => void;
}

// ── Result ───────────────────────────────────────────────────────────

export interface MapFactoryResult {
  map: maplibregl.Map;
  session: ReturnType<typeof createMapSession>;
  polylineLayer: PolylineLayer;
  photoLayer: MapLayer | null;
  placeLayer: MapLayer | null;
  expandable: ReturnType<typeof createExpandableMap> | null;
}

// ── Factory ──────────────────────────────────────────────────────────

export function setupMap(opts: MapFactoryOptions): MapFactoryResult {
  const {
    el, center, zoom = 12,
    polylines = [], photos = [], places = [], waypoints = [],
    cdnUrl = '',
    extraLayers = [],
    defaultPhotos = false, defaultPlaces = false,
    controlsEl,
    expandable: expandableEls,
    onReady, onExpandChange,
  } = opts;

  // Create layers
  const polylineData = polylines.map(p => ({
    encoded: p.encoded,
    popup: p.popup || '',
    ...(p.color && { color: p.color }),
  }));
  const polylineLayer = createPolylineLayer({ polylines: polylineData }) as PolylineLayer;

  const photoLayer = photos.length > 0
    ? createPhotoLayer({ photos, cdnUrl, defaultVisible: false })
    : null;

  const placeLayer = places.length > 0
    ? createPlaceLayer({ places, defaultVisible: false })
    : null;

  const waypointLayer = waypoints.length > 0
    ? createWaypointLayer({ waypoints })
    : null;

  // Build session
  const session = createMapSession({ el, center, zoom });
  session.use(polylineLayer);
  if (photoLayer) session.use(photoLayer);
  if (placeLayer) session.use(placeLayer);
  if (waypointLayer) session.use(waypointLayer);
  session.use(createElevationSyncLayer());
  for (const layer of extraLayers) session.use(layer);

  const { map } = session;

  // Expandable mode
  let expandableResult: ReturnType<typeof createExpandableMap> | null = null;
  if (expandableEls) {
    // Track user layer preferences
    let wantsPhotos = loadToggleState('map-photos', defaultPhotos);
    let wantsPlaces = loadToggleState('map-places', defaultPlaces);

    function applyOverlayVisibility() {
      const isExp = expandableResult?.isExpanded() ?? false;
      if (photoLayer) photoLayer.setVisible!(map, isExp && wantsPhotos);
      if (placeLayer) placeLayer.setVisible!(map, isExp && wantsPlaces);
      onExpandChange?.(isExp);
    }

    expandableResult = createExpandableMap(map, expandableEls, {
      getBounds: () => polylineLayer.getBounds?.() ?? null,
      onExpand: applyOverlayVisibility,
      onCollapse: applyOverlayVisibility,
    });

    session.start(() => onReady?.({ map, session, polylineLayer, photoLayer, placeLayer, expandable: expandableResult }));

    // Controls — rendered after map loads, CSS-hidden in compact mode
    map.on('load', () => {
      if (controlsEl) {
        render(h(MapControls, {
          hasPhotos: photos.length > 0,
          hasPlaces: places.length > 0,
          defaultPhotos: false,
          defaultPlaces: false,
          onTogglePhotos: (v: boolean) => { wantsPhotos = v; applyOverlayVisibility(); },
          onTogglePlaces: (v: boolean) => { wantsPlaces = v; applyOverlayVisibility(); },
          onToggleStyle: (key: MapStyleKey) => session.switchStyle(key),
        }), controlsEl);
      }
    });
  } else {
    // Non-expandable: controls directly toggle layers
    session.start(() => onReady?.({ map, session, polylineLayer, photoLayer, placeLayer, expandable: null }));

    map.on('load', () => {
      if (controlsEl) {
        render(h(MapControls, {
          hasPhotos: photos.length > 0,
          hasPlaces: places.length > 0,
          onTogglePhotos: (v: boolean) => { if (photoLayer) photoLayer.setVisible!(map, v); },
          onTogglePlaces: (v: boolean) => { if (placeLayer) placeLayer.setVisible!(map, v); },
          onToggleStyle: (key: MapStyleKey) => session.switchStyle(key, () => {
            if (photoLayer) photoLayer.setVisible!(map, loadToggleState('map-photos', defaultPhotos));
            if (placeLayer) placeLayer.setVisible!(map, loadToggleState('map-places', defaultPlaces));
          }),
        }), controlsEl);
      }
    });
  }

  return { map, session, polylineLayer, photoLayer, placeLayer, expandable: expandableResult };
}

// ── Variant helper ───────────────────────────────────────────────────

/**
 * Wire up variant switching: listens for variant:change events and
 * swaps the polyline + fits bounds.
 */
export function wireVariantSwitch(
  map: maplibregl.Map,
  polylineLayer: PolylineLayer,
  allPolylines: MapPolyline[],
) {
  window.addEventListener('variant:change', ((e: CustomEvent<{ key: string }>) => {
    const key = e.detail.key;
    const idx = allPolylines.findIndex(p => p.key === key);
    if (idx >= 0) {
      const selected = allPolylines[idx];
      const feature = buildPolylineFeature(selected.encoded, selected.popup || '');
      polylineLayer.updateData([feature]);
      const b = polylineLayer.getBounds?.();
      if (b && !b.isEmpty()) map.fitBounds(b, { padding: 20, animate: true });
    }
  }) as EventListener);
}
