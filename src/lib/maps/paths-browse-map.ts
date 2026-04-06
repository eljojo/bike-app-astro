/**
 * Browse-style map for bike paths — always-interactive, with tile loading,
 * rich popups, hover highlight, and expand button.
 *
 * Extracted from the index page's inline map setup. Used by both the
 * paths index and network detail pages.
 *
 * Browser-only — uses DOM APIs and MapLibre. Import only from <script> blocks.
 */

import { initMap, showPopup, ROUTE_COLOR, ROUTE_LINE_WIDTH } from './map-init';
import { loadStylePreference, getStyleUrl } from './map-style-switch';
import { setupMapTouchLock } from './map-touch-lock';
import { setupPathHighlight } from './path-highlight';
import { html, raw } from './map-helpers';
import { createTileLoader, type TileLoader } from './tile-loader';
import { createMapExpandButton } from './map-expand-button';
import maplibregl from 'maplibre-gl';

// ── Types ────────────────────────────────────────────────────────────

export interface SlugInfo {
  name: string;
  url: string;
  length_km?: number;
  surface?: string;
  path_type?: string;
  vibe?: string;
  network?: string;
  networkUrl?: string;
}

export interface PathsBrowseMapOptions {
  /** Container element for the map. */
  container: HTMLElement;
  /** Touch lock overlay element. Null = no touch lock. */
  touchLockEl: HTMLElement | null;
  /** Map center as [lat, lng]. */
  center: [number, number];
  /** Initial zoom level (default: 11). */
  zoom?: number;
  /** Container height in compact state (px). */
  compactHeight: number;
  /** Container height in expanded state (px, desktop only — mobile goes fullscreen). */
  expandedHeight: number;
  /** Popup info for each path, keyed by slug. */
  slugInfo: Record<string, SlugInfo>;
  /**
   * Geo IDs to mark as interactive (bold, clickable).
   * When omitted, uses the tile feature's `hasPage` property (index behavior).
   * When provided, only features with matching `_geoId` are interactive (network detail behavior).
   */
  interactiveGeoIds?: Set<string>;
  /** CSS selector for list items with data-slug for hover highlight. */
  listSelector?: string;
  /** Slug → network slug mapping, passed through to setupPathHighlight. */
  slugToNetwork?: Record<string, string>;
  /** Network slug → geo ID array, passed through to setupPathHighlight. */
  networkGeoIds?: Record<string, string[]>;
  /** Called when hover highlight clears (mouseleave). Receives the result for fly-back. */
  onHighlightClear?: (result: PathsBrowseMapResult) => void;
  /** Called after tile layers are set up and ready for interaction. */
  onReady?: (result: PathsBrowseMapResult) => void;
  /** Localized UI labels for the map popup. */
  labels?: { viewDetails?: string };
}

export interface PathsBrowseMapResult {
  /** The MapLibre map instance. */
  map: maplibregl.Map;
  /** Highlight a set of geo IDs on the highlight layer. Pass null to clear. */
  highlightGeoIds: (geoIds: string[] | null, fly?: boolean) => void;
  /** Fit the map to the bounds of features matching the given geo IDs. */
  fitToGeoIds: (geoIds: string[]) => void;
  /** Expand button controller. */
  expandButton: ReturnType<typeof createMapExpandButton>;
}

// ── Implementation ───────────────────────────────────────────────────

const PATH_WIDTH = ROUTE_LINE_WIDTH;
const PATH_WIDTH_UNLISTED = Math.max(2, ROUTE_LINE_WIDTH - 2);
const PATH_WIDTH_HOVER = ROUTE_LINE_WIDTH + 2;
const SOURCE_ID = 'paths-network';

export function createPathsBrowseMap(opts: PathsBrowseMapOptions): PathsBrowseMapResult {
  const {
    container, touchLockEl,
    center, zoom = 11,
    compactHeight, expandedHeight,
    slugInfo, interactiveGeoIds,
    listSelector, slugToNetwork, networkGeoIds,
    onHighlightClear, onReady,
  } = opts;

  const styleKey = loadStylePreference();
  const map = initMap({ el: container, center, zoom, styleUrl: getStyleUrl(styleKey) });

  setupMapTouchLock(map, touchLockEl);
  const expandButton = createMapExpandButton(map, container, { compactHeight, expandedHeight });

  // Build result early so callbacks can reference it
  const result: PathsBrowseMapResult = {
    map,
    highlightGeoIds: highlightGeoIdsFn,
    fitToGeoIds: fitToGeoIdsFn,
    expandButton,
  };

  // ── Feature tagging ──────────────────────────────────────────────

  function tagFeatures(features: GeoJSON.Feature[]) {
    for (const f of features) {
      if (!f.properties) continue;
      if (interactiveGeoIds) {
        f.properties.interactive = interactiveGeoIds.has(f.properties._geoId) ? 'true' : '';
      } else {
        f.properties.interactive = f.properties.hasPage ? 'true' : '';
      }
      f.properties.relationId = f.properties._geoId;
    }
  }

  // ── Highlight layer control ──────────────────────────────────────

  function highlightGeoIdsFn(geoIds: string[] | null, fly = false) {
    if (!map.getLayer('paths-network-highlight')) return;

    if (geoIds && geoIds.length > 0) {
      map.setFilter('paths-network-highlight', ['in', ['get', 'relationId'], ['literal', geoIds]]);
      for (const id of ['paths-network-line', 'paths-network-line-dashed']) {
        if (map.getLayer(id)) map.setPaintProperty(id, 'line-opacity', 0.3);
      }
      for (const id of ['paths-network-bg', 'paths-network-bg-dashed']) {
        if (map.getLayer(id)) map.setPaintProperty(id, 'line-opacity', 0.15);
      }
      if (fly) fitToGeoIdsFn(geoIds);
    } else {
      map.setFilter('paths-network-highlight', ['==', ['get', 'relationId'], '']);
      for (const id of ['paths-network-line', 'paths-network-line-dashed']) {
        if (map.getLayer(id)) map.setPaintProperty(id, 'line-opacity', 0.8);
      }
      for (const id of ['paths-network-bg', 'paths-network-bg-dashed']) {
        if (map.getLayer(id)) map.setPaintProperty(id, 'line-opacity', 0.5);
      }
    }
  }

  function fitToGeoIdsFn(geoIds: string[]) {
    if (!map.getSource(SOURCE_ID)) return;
    const features = map.querySourceFeatures(SOURCE_ID, {
      filter: ['in', ['get', 'relationId'], ['literal', geoIds]],
    });
    if (features.length === 0) return;
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const f of features) {
      const coords = f.geometry.type === 'LineString' ? (f.geometry as GeoJSON.LineString).coordinates
        : f.geometry.type === 'MultiLineString' ? (f.geometry as GeoJSON.MultiLineString).coordinates.flat()
        : [];
      for (const [lng, lat] of coords as [number, number][]) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
    if (minLng === Infinity) return;
    map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 60, animate: true, duration: 500 });
  }

  // ── Layer setup ──────────────────────────────────────────────────

  let layersSetUp = false;
  let prevFeatureCount = 0;

  function setupLayers(features: GeoJSON.Feature[]) {
    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
    });

    const TRAIL_DASH: [number, number] = [3, 1];

    // Non-interactive: solid
    map.addLayer({
      id: 'paths-network-bg', type: 'line', source: SOURCE_ID,
      filter: ['all', ['!=', ['get', 'interactive'], 'true'], ['!=', ['get', 'dashed'], true]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ROUTE_COLOR, 'line-width': PATH_WIDTH_UNLISTED, 'line-opacity': 0.5 },
    });
    // Non-interactive: dashed
    map.addLayer({
      id: 'paths-network-bg-dashed', type: 'line', source: SOURCE_ID,
      filter: ['all', ['!=', ['get', 'interactive'], 'true'], ['==', ['get', 'dashed'], true]],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': ROUTE_COLOR, 'line-width': PATH_WIDTH_UNLISTED, 'line-opacity': 0.5, 'line-dasharray': TRAIL_DASH },
    });
    // Interactive: solid
    map.addLayer({
      id: 'paths-network-line', type: 'line', source: SOURCE_ID,
      filter: ['all', ['==', ['get', 'interactive'], 'true'], ['!=', ['get', 'dashed'], true]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ROUTE_COLOR, 'line-width': PATH_WIDTH, 'line-opacity': 0.8 },
    });
    // Interactive: dashed
    map.addLayer({
      id: 'paths-network-line-dashed', type: 'line', source: SOURCE_ID,
      filter: ['all', ['==', ['get', 'interactive'], 'true'], ['==', ['get', 'dashed'], true]],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': ROUTE_COLOR, 'line-width': PATH_WIDTH, 'line-opacity': 0.8, 'line-dasharray': TRAIL_DASH },
    });
    // Highlight layer (for category/network selection from outside)
    map.addLayer({
      id: 'paths-network-highlight', type: 'line', source: SOURCE_ID,
      filter: ['==', ['get', 'relationId'], ''],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ROUTE_COLOR, 'line-width': PATH_WIDTH + 2, 'line-opacity': 1 },
    });

    // Click → rich popup
    function handleClick(e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) {
      if (!e.features?.length) return;
      const slug = e.features[0].properties?.slug;
      if (!slug) return;
      const info = slugInfo[slug];
      if (!info) return;

      const meta: string[] = [];
      if (info.length_km) meta.push(`${info.length_km} km`);
      if (info.surface) meta.push(info.surface);
      if (info.path_type) meta.push(info.path_type);

      const content = html`<div class="path-popup">
        <strong class="path-popup-name">${info.name}</strong>
        ${info.network ? raw(info.networkUrl ? html`<div class="path-popup-network"><a href="${info.networkUrl}" class="path-popup-network-link">${info.network}</a></div>` : html`<div class="path-popup-network">${info.network}</div>`) : ''}
        ${meta.length > 0 ? raw(html`<div class="path-popup-meta">${meta.join(' \u00b7 ')}</div>`) : ''}
        ${info.vibe ? raw(html`<div class="path-popup-vibe">${info.vibe}</div>`) : ''}
        <a href="${info.url}" class="path-popup-link">${opts.labels?.viewDetails ?? 'View details'} \u2192</a>
      </div>`;

      const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '280px' })
        .setLngLat(e.lngLat)
        .setHTML(content);
      showPopup(map, popup);
    }

    for (const id of ['paths-network-line', 'paths-network-line-dashed', 'paths-network-bg', 'paths-network-bg-dashed']) {
      map.on('click', id, handleClick);
    }
    for (const layerId of ['paths-network-line', 'paths-network-line-dashed', 'paths-network-bg', 'paths-network-bg-dashed', 'paths-network-highlight']) {
      map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
    }

    // List hover → highlight path on map + fly to
    if (listSelector) {
      let clearDebounce: ReturnType<typeof setTimeout> | null = null;

      setupPathHighlight(map, {
        listSelector,
        layerIds: ['paths-network-line', 'paths-network-line-dashed'],
        lineWidth: PATH_WIDTH,
        lineWidthHover: PATH_WIDTH_HOVER,
        lineOpacity: 0.8,
        sourceId: SOURCE_ID,
        slugToNetwork,
        networkGeoIds,
        onHighlight: (slug) => {
          // Cancel any pending fly-back when a new path is highlighted
          if (clearDebounce) { clearTimeout(clearDebounce); clearDebounce = null; }

          // When hovering a path, hide bg and highlight layers for clean focus
          for (const id of ['paths-network-highlight', 'paths-network-bg', 'paths-network-bg-dashed']) {
            if (map.getLayer(id)) {
              map.setLayoutProperty(id, 'visibility', slug ? 'none' : 'visible');
            }
          }
          if (!slug) {
            // Debounce fly-back so moving between paths within a group
            // doesn't cause jumpy zoom (only fires when truly leaving the list)
            clearDebounce = setTimeout(() => {
              onHighlightClear?.(result);
            }, 200);
          }
        },
      });
    }

    layersSetUp = true;
    onReady?.(result);
  }

  // ── Tile loading ─────────────────────────────────────────────────

  function getMapBounds(): [number, number, number, number] {
    const b = map.getBounds();
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  }

  map.on('load', async () => {
    let tileLoader: TileLoader;
    try {
      const res = await fetch('/bike-paths/geo/tiles/manifest.json');
      if (!res.ok) return;
      const manifest = await res.json();
      tileLoader = createTileLoader(manifest, '/bike-paths/geo/tiles/');
    } catch {
      return;
    }

    const features = await tileLoader.loadTilesForBounds(getMapBounds());
    tagFeatures(features);
    prevFeatureCount = features.length;

    if (features.length > 0) {
      setupLayers(features);
    }

    map.on('moveend', async () => {
      const updated = await tileLoader.loadTilesForBounds(getMapBounds());
      if (updated.length === prevFeatureCount) return;

      tagFeatures(updated);
      prevFeatureCount = updated.length;

      if (!layersSetUp) {
        if (updated.length > 0) setupLayers(updated);
        return;
      }

      const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource;
      if (source) {
        source.setData({ type: 'FeatureCollection', features: updated });
      }
    });
  });

  return result;
}
