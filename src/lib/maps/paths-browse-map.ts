/**
 * Browse-style map for bike paths — always-interactive, with tile loading,
 * rich popups, hover highlight, and expand button.
 *
 * Thin orchestrator: delegates all rendering to tile-path-layer.
 * Owns only UI concerns: map init, touch lock, expand button, list hover.
 *
 * Browser-only — uses DOM APIs and MapLibre. Import only from <script> blocks.
 */

import { initMap, closePopup } from './map-init';
import { pathForeground } from './map-swatch';
import { loadStylePreference, getStyleUrl } from './map-style-switch';
import { setupMapTouchLock } from './map-touch-lock';
import { setupPathHighlight, type PathHighlightHandle } from './path-highlight';
import { createMapExpandButton } from './map-expand-button';
import { createTilePathLayer } from './layers/tile-path-layer';
import { muteBaseCyclingLayers } from './base-layer-control';
import { buildPathCardContent, iterLineCoords } from './map-helpers';
import { boundsFromCoords, toFitBoundsArg } from '../geo/bounds';
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
  highlightGeoIds: (geoIds: string[] | null, fly?: boolean, flyOpts?: { maxZoom?: number; padding?: number }) => void;
  /** Fit the map to the bounds of features matching the given geo IDs. Returns false if no features found. */
  fitToGeoIds: (geoIds: string[], opts?: { maxZoom?: number; padding?: number }) => Promise<boolean>;
  /** Lock the list highlight on a slug — hover is suppressed until unlock. */
  lockOnSlug: (slug: string) => void;
  /** Unlock the list highlight, clearing the locked slug. */
  unlockHighlight: () => void;
  /** Whether the list highlight is currently locked. */
  isHighlightLocked: () => boolean;
  /** Select a path/network by slug: locks the highlight, flies the map
   *  to its bounds, and shows the floating path card at the bottom. */
  showPopupForSlug: (slug: string) => void;
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

  const isMobile = window.matchMedia('(max-width: 768px)').matches;

  // ── Map creation ────────────────────────────────────────────────

  const styleKey = loadStylePreference();
  const map = initMap({ el: container, center, zoom, styleUrl: getStyleUrl(styleKey) });

  setupMapTouchLock(map, isMobile ? null : touchLockEl);
  if (isMobile && touchLockEl) touchLockEl.style.display = 'none';
  const expandButton = createMapExpandButton(map, container, { compactHeight, expandedHeight });

  // ── Path card (replaces the MapLibre popup) ─────────────────────
  //
  // A floating island at the bottom of the map that shows info for the
  // currently-locked path or network. Slides up from below on lock,
  // slides back down on unlock. The X inside the card triggers unlock.
  // Created once and updated in place so switching between paths
  // swaps content without flicker.

  const card = document.createElement('div');
  card.className = 'map-path-card';
  card.setAttribute('role', 'status');
  card.setAttribute('aria-live', 'polite');

  const cardContent = document.createElement('div');
  cardContent.className = 'map-path-card-content';
  card.appendChild(cardContent);

  const cardClose = document.createElement('button');
  cardClose.type = 'button';
  cardClose.className = 'map-path-card-close';
  cardClose.innerHTML = '&#x2715;'; // ✕
  cardClose.setAttribute('aria-label', 'Clear selection');
  cardClose.title = 'Clear selection';
  card.appendChild(cardClose);

  container.appendChild(card);

  cardClose.addEventListener('click', (e) => {
    e.stopPropagation();
    _highlightHandle?.unlock();
  });

  function showPathCard(html: string) {
    cardContent.innerHTML = html;
    card.classList.add('map-path-card--visible');
  }
  function hidePathCard() {
    card.classList.remove('map-path-card--visible');
  }

  // Clicks anywhere outside the browse widget clear the lock. The card
  // is the visual for the locked state, so dismissing it releases the
  // lock too — consistent with the old "outside click closes popup"
  // behavior, just applied to the card/lock as a unit now.
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target || target.closest('.paths-browse')) return;
    _highlightHandle?.unlock();
    closePopup(map); // defensive: clears any stray popup from other flows
  });
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
    // Route map-feature clicks through the same flow as sidebar list
    // clicks — both lock the highlight and render the card.
    onPathClick: (slug) => { showPathCardForSlug(slug); },
  });

  // ── Highlight lock / popup ─────────────────────────────────────

  let _highlightHandle: PathHighlightHandle | null = null;

  async function showPathCardForSlug(slug: string) {
    // Toggle off: clicking the currently-locked path/network unlocks.
    // The card auto-hides via the onLockChange callback.
    if (_highlightHandle?.lockedSlug() === slug) {
      _highlightHandle.unlock();
      return;
    }

    const features = tilePathLayer.queryFeaturesBySlug(slug, networkGeoIds);
    if (features.length === 0) return;

    // Build card content from slugInfo or tile properties, then show it
    // immediately (before the fly) so the user gets an instant
    // confirmation of what they clicked.
    const info = slugInfo?.[slug];
    const cardHtml = info
      ? buildPathCardContent({
        name: info.name, url: info.url,
        length_km: info.length_km, surface: info.surface,
        path_type: info.path_type, vibe: info.vibe,
        network: info.network, networkUrl: info.networkUrl,
      })
      : buildPathCardContent({
        name: features[0]?.properties?.name || slug,
        url: undefined,
        length_km: features[0]?.properties?.length_km ? Number(features[0].properties.length_km) : undefined,
        surface: features[0]?.properties?.surface || undefined,
        path_type: features[0]?.properties?.path_type || undefined,
      });

    // Lock now that we know features exist. Overrides any previous lock
    // (switching paths). Hover suppression stays on until the user
    // explicitly unlocks.
    _highlightHandle?.lock(slug);
    showPathCard(cardHtml);

    // Fly to path bounds so the locked path is visible above the card.
    // Use an asymmetric padding so the card's rendered height (variable
    // based on whether a vibe/network line is present) is excluded from
    // the fit zone — otherwise the bottom of the path sits behind the
    // frosted card.
    const bounds = boundsFromCoords(iterLineCoords(features));
    if (bounds) {
      const bottomCoverage = card.offsetHeight + 12 + 20; // card + bottom offset + breathing room
      map.fitBounds(toFitBoundsArg(bounds), {
        padding: { top: 60, right: 60, bottom: bottomCoverage, left: 60 },
        maxZoom: 14,
        animate: true,
        duration: 500,
      });
    }
  }

  // ── Result object (delegates to layer) ──────────────────────────

  const result: PathsBrowseMapResult = {
    map,
    highlightGeoIds: (geoIds, fly, flyOpts) => tilePathLayer.highlightGeoIds(map, geoIds, fly, flyOpts),
    fitToGeoIds: (geoIds, opts) => tilePathLayer.fitToGeoIds(map, geoIds, opts),
    lockOnSlug: (slug) => _highlightHandle?.lock(slug),
    unlockHighlight: () => _highlightHandle?.unlock(),
    isHighlightLocked: () => _highlightHandle?.isLocked() ?? false,
    showPopupForSlug: (slug) => { showPathCardForSlug(slug); },
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

      _highlightHandle = setupPathHighlight(map, {
        listSelector,
        layerIds: ['paths-network-line', 'paths-network-line-gravel', 'paths-network-line-mtb'],
        lineWidth: PATH_WIDTH,
        lineWidthHover: PATH_WIDTH_HOVER,
        lineOpacity: PATH_OPACITY,
        lineOpacityDim: pathForeground.hover.dimOpacity,
        onListClick: (slug) => showPathCardForSlug(slug),
        sourceId: SOURCE_ID,
        queryFeatures: (slug) => tilePathLayer.queryFeaturesBySlug(slug, networkGeoIds),
        slugToNetwork,
        networkGeoIds,
        mobile: isMobile,
        onLockChange: (locked) => {
          if (!locked) hidePathCard();
        },
        onHighlight: (slug) => {
          // Cancel any pending fly-back when a new path is highlighted
          if (clearDebounce) { clearTimeout(clearDebounce); clearDebounce = null; }

          // Close popup when highlight clears (background click/tap dismiss)
          if (!slug) {
            closePopup(map);
          }

          // Always hide the category highlight layer during hover
          if (map.getLayer('paths-network-highlight')) {
            map.setLayoutProperty('paths-network-highlight', 'visibility', slug ? 'none' : 'visible');
          }

          // For bg layers: instead of hiding entirely, apply the same highlight
          // filter so matching features stay visible. This is needed because some
          // network members have hasPage=false and only exist on bg layers.
          for (const id of ['paths-network-bg', 'paths-network-bg-gravel', 'paths-network-bg-mtb']) {
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

      // Click/tap on map background dismisses popup and clears highlight
      {
        map.on('click', (e) => {
          // Don't dismiss if the click was on a path feature (tile layer handles those)
          const features = map.queryRenderedFeatures(e.point, {
            layers: ['paths-network-line', 'paths-network-line-gravel', 'paths-network-line-mtb',
                     'paths-network-bg', 'paths-network-bg-gravel', 'paths-network-bg-mtb'],
          });
          if (features.length > 0) return;
          _highlightHandle!.clear();
        });
      }
    }

    onReady?.(result);
  });

  return result;
}
