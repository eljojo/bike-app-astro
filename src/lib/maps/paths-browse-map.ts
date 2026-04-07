/**
 * Browse-style map for bike paths — always-interactive, with tile loading,
 * rich popups, hover highlight, and expand button.
 *
 * Thin orchestrator: delegates all rendering to tile-path-layer.
 * Owns only UI concerns: map init, touch lock, expand button, list hover.
 *
 * Browser-only — uses DOM APIs and MapLibre. Import only from <script> blocks.
 */

import { initMap } from './map-init';
import { pathForeground } from './map-swatch';
import { loadStylePreference, getStyleUrl } from './map-style-switch';
import { setupMapTouchLock } from './map-touch-lock';
import { setupPathHighlight } from './path-highlight';
import { createMapExpandButton } from './map-expand-button';
import { createTilePathLayer } from './layers/tile-path-layer';
import { muteBaseCyclingLayers } from './base-layer-control';
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

// ── Swatch values for list hover ─────────────────────────────────────

const PATH_WIDTH = pathForeground.interactive.width;
const PATH_WIDTH_UNLISTED = pathForeground.other.width;
const PATH_WIDTH_HOVER = pathForeground.hover.width;
const PATH_OPACITY = pathForeground.interactive.opacity;
const PATH_OPACITY_UNLISTED = pathForeground.other.opacity;
const SOURCE_ID = 'paths-network';

// ── Implementation ───────────────────────────────────────────────────

export function createPathsBrowseMap(opts: PathsBrowseMapOptions): PathsBrowseMapResult {
  const {
    container, touchLockEl,
    center, zoom = 11,
    compactHeight, expandedHeight,
    slugInfo, interactiveGeoIds,
    listSelector, slugToNetwork, networkGeoIds,
    onHighlightClear, onReady,
  } = opts;

  // ── Map creation ────────────────────────────────────────────────

  const styleKey = loadStylePreference();
  const map = initMap({ el: container, center, zoom, styleUrl: getStyleUrl(styleKey) });

  setupMapTouchLock(map, touchLockEl);
  const expandButton = createMapExpandButton(map, container, { compactHeight, expandedHeight });

  // ── Tile path layer ─────────────────────────────────────────────

  const manifestPromise = fetch('/bike-paths/geo/tiles/manifest.json')
    .then(r => r.ok ? r.json() : []).catch(() => []);

  const tilePathLayer = createTilePathLayer({
    manifestPromise,
    fetchPath: '/bike-paths/geo/tiles/',
    foreground: true,
    interactiveGeoIds,
    slugInfo,
    labels: opts.labels,
  });

  // ── Result object (delegates to layer) ──────────────────────────

  const result: PathsBrowseMapResult = {
    map,
    highlightGeoIds: (geoIds, fly) => tilePathLayer.highlightGeoIds(map, geoIds, fly),
    fitToGeoIds: (geoIds) => tilePathLayer.fitToGeoIds(map, geoIds),
    expandButton,
  };

  // ── On map load: set up layer, then wire list hover ─────────────

  map.on('load', async () => {
    muteBaseCyclingLayers(map);

    const ctx = {
      map,
      styleKey,
      generation: 0,
      isCurrent: () => true,
    };
    await tilePathLayer.setup(ctx);

    // Wire list hover (browse-specific UI concern)
    if (listSelector) {
      let clearDebounce: ReturnType<typeof setTimeout> | null = null;

      setupPathHighlight(map, {
        listSelector,
        layerIds: ['paths-network-line', 'paths-network-line-dashed'],
        lineWidth: PATH_WIDTH,
        lineWidthHover: PATH_WIDTH_HOVER,
        lineOpacity: PATH_OPACITY,
        lineOpacityDim: pathForeground.hover.dimOpacity,
        sourceId: SOURCE_ID,
        slugToNetwork,
        networkGeoIds,
        onHighlight: (slug) => {
          // Cancel any pending fly-back when a new path is highlighted
          if (clearDebounce) { clearTimeout(clearDebounce); clearDebounce = null; }

          // Always hide the category highlight layer during hover
          if (map.getLayer('paths-network-highlight')) {
            map.setLayoutProperty('paths-network-highlight', 'visibility', slug ? 'none' : 'visible');
          }

          // For bg layers: instead of hiding entirely, apply the same highlight
          // filter so matching features stay visible. This is needed because some
          // network members have hasPage=false and only exist on bg layers.
          for (const id of ['paths-network-bg', 'paths-network-bg-dashed']) {
            if (!map.getLayer(id)) continue;
            if (slug) {
              const isNetwork = networkGeoIds?.[slug];
              const matchFilter: maplibregl.ExpressionSpecification = isNetwork
                ? ['in', ['get', 'relationId'], ['literal', networkGeoIds![slug]]]
                : ['==', ['get', 'slug'], slug];
              map.setPaintProperty(id, 'line-opacity', ['case', matchFilter, PATH_OPACITY, 0]);
              map.setPaintProperty(id, 'line-width', ['case', matchFilter, PATH_WIDTH, PATH_WIDTH_UNLISTED]);
            } else {
              map.setPaintProperty(id, 'line-opacity', PATH_OPACITY_UNLISTED);
              map.setPaintProperty(id, 'line-width', PATH_WIDTH_UNLISTED);
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

    onReady?.(result);
  });

  return result;
}
