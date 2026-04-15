// src/lib/maps/path-highlight.ts
//
// Shared list↔map hover highlight for bike path pages.
// Works with both GeoJSON layers (network detail) and tile layers (paths index).
//
// Architecture: DOM events write to `wantSlug` (what the mouse is on).
// A sync loop reads `wantSlug` and applies it to the map. This decoupling
// eliminates race conditions from mouseenter/mouseleave event ordering.
import type maplibregl from 'maplibre-gl';
import { boundsFromCoords, toFitBoundsArg } from '../geo/bounds';
import { iterLineCoords } from './map-helpers';

export interface PathHighlightOptions {
  /** CSS selector for list items with data-slug attributes */
  listSelector: string;
  /** MapLibre layer IDs to apply highlight to */
  layerIds: string[];
  /** GeoJSON property name that holds the slug (default: 'slug') */
  property?: string;
  /** Line width when not highlighted */
  lineWidth?: number;
  /** Line width when highlighted */
  lineWidthHover?: number;
  /** Line opacity when not highlighted */
  lineOpacity?: number;
  /** Line opacity when highlighted (others dim) */
  lineOpacityHover?: number;
  /** Line opacity for non-highlighted paths when one is highlighted */
  lineOpacityDim?: number;
  /** GeoJSON source ID to query for fly-to bounds (fallback if queryFeatures not provided) */
  sourceId?: string;
  /** Query in-memory features by slug or network geoIds. Avoids querySourceFeatures race condition. */
  queryFeatures?: (slug: string) => GeoJSON.Feature[];
  /** Slug → network slug mapping, for framing the whole network on hover */
  slugToNetwork?: Record<string, string>;
  /** Network slug → geo IDs, for computing network bounds */
  networkGeoIds?: Record<string, string[]>;
  /** Called when highlight changes — slug is the hovered slug or null on leave */
  onHighlight?: (slug: string | null) => void;
  /** Called when a list item is clicked (both mobile and desktop). Receives the slug. */
  onListClick?: (slug: string) => void;
  /** Use click (tap) events instead of mouseenter/mouseleave */
  mobile?: boolean;
}

export interface PathHighlightHandle {
  /** Clear the current highlight (no-op when locked). */
  clear: () => void;
  /** Lock highlight on a slug — hover events are suppressed until unlock(). */
  lock: (slug: string) => void;
  /** Unlock: clear highlight and resume hover. */
  unlock: () => void;
  /** Whether the highlight is currently locked. */
  isLocked: () => boolean;
  /** Slug the highlight is currently locked on, or null when unlocked. */
  lockedSlug: () => string | null;
}

const DEFAULTS = {
  property: 'slug',
  lineWidth: 6,
  lineWidthHover: 8,
  lineOpacity: 0.85,
  lineOpacityHover: 1,
  lineOpacityDim: 0,
};

/** Delay before fly-to fires (avoids jitter when scanning the list). */
const FLY_DELAY_MS = 300;
/** After this long on the same item, re-ensure the fly-to landed. */
const SETTLE_MS = 1500;

/**
 * Wire up list hover → map path highlight + optional fly-to.
 * List items must have `data-slug` attributes matching the feature property.
 */
export function setupPathHighlight(map: maplibregl.Map, opts: PathHighlightOptions): PathHighlightHandle {
  const o = { ...DEFAULTS, ...opts };

  // --- State: what the mouse wants vs what the map shows ---
  let wantSlug: string | null = null;   // written by DOM events
  let appliedSlug: string | null = null; // what's currently on the map
  let flyTimeout: ReturnType<typeof setTimeout> | null = null;
  let settleTimeout: ReturnType<typeof setTimeout> | null = null;
  let syncScheduled = false;
  let locked = false; // when true, hover events are suppressed

  // --- Sync: read wantSlug, apply to map if changed ---

  function scheduleSync() {
    if (syncScheduled) return;
    syncScheduled = true;
    requestAnimationFrame(sync);
  }

  function sync() {
    syncScheduled = false;
    if (wantSlug === appliedSlug) return;

    // Clear pending fly timers — the target changed
    if (flyTimeout) { clearTimeout(flyTimeout); flyTimeout = null; }
    if (settleTimeout) { clearTimeout(settleTimeout); settleTimeout = null; }

    appliedSlug = wantSlug;
    applyHighlight(appliedSlug);

    // Skip fly-to when locked — the click handler manages its own fly-to
    if (!locked && appliedSlug && o.sourceId) {
      const slug = appliedSlug;
      flyTimeout = setTimeout(() => flyToSlug(slug), FLY_DELAY_MS);
      settleTimeout = setTimeout(() => {
        if (wantSlug === slug) flyToSlug(slug, true);
      }, SETTLE_MS);
    }
  }

  // --- Apply: update MapLibre paint properties + notify ---

  function applyHighlight(slug: string | null) {
    const isNetwork = slug && o.networkGeoIds?.[slug];
    const matchFilter: maplibregl.ExpressionSpecification = isNetwork
      ? ['in', ['get', 'relationId'], ['literal', o.networkGeoIds![slug!]]]
      : ['==', ['get', o.property], slug ?? ''];

    for (const layerId of o.layerIds) {
      if (!map.getLayer(layerId)) continue;

      if (slug) {
        map.setPaintProperty(layerId, 'line-width', [
          'case', matchFilter, o.lineWidthHover, o.lineWidth,
        ]);
        map.setPaintProperty(layerId, 'line-opacity', [
          'case', matchFilter, o.lineOpacityHover, o.lineOpacityDim,
        ]);
      } else {
        map.setPaintProperty(layerId, 'line-width', o.lineWidth);
        map.setPaintProperty(layerId, 'line-opacity', o.lineOpacity);
      }
    }

    o.onHighlight?.(slug);
  }

  // --- Fly-to ---

  function flyToSlug(slug: string, instant = false) {
    if (!o.sourceId && !o.queryFeatures) return;

    let features: GeoJSON.Feature[];
    if (o.queryFeatures) {
      // Use in-memory features — no renderer race condition
      features = o.queryFeatures(slug);
    } else {
      const isNetwork = o.networkGeoIds?.[slug];
      features = map.querySourceFeatures(o.sourceId!, {
        filter: isNetwork
          ? ['in', ['get', 'relationId'], ['literal', o.networkGeoIds![slug]]]
          : ['==', ['get', o.property], slug],
      });
    }

    if (features.length === 0) return;

    const bounds = boundsFromCoords(iterLineCoords(features));
    if (!bounds) return;

    map.fitBounds(toFitBoundsArg(bounds), {
      padding: 60,
      maxZoom: 14,
      animate: !instant,
      duration: 500,
    });
  }

  function clear() {
    if (locked) return; // respect lock — only unlock() can clear when locked
    wantSlug = null;
    scheduleSync();
  }

  function lock(slug: string) {
    locked = true;
    wantSlug = slug;
    scheduleSync();
  }

  function unlock() {
    if (!locked) return;
    locked = false;
    wantSlug = null;
    scheduleSync();
  }

  // --- DOM events: just write wantSlug, schedule sync ---
  document.querySelectorAll<HTMLElement>(o.listSelector).forEach(el => {
    const slug = el.dataset.slug || null;

    // Click: prevent navigation, notify via callback (both mobile and desktop)
    el.addEventListener('click', (e) => {
      if (!slug) return;
      e.preventDefault();
      o.onListClick?.(slug);
    });

    if (!o.mobile) {
      // Desktop hover: enter always wins, leave only clears if this element still owns the slug
      el.addEventListener('mouseenter', () => { if (!locked) { wantSlug = slug; scheduleSync(); } });
      el.addEventListener('mouseleave', () => { if (!locked && wantSlug === slug) { wantSlug = null; scheduleSync(); } });
    }
  });

  return {
    clear,
    lock,
    unlock,
    isLocked: () => locked,
    lockedSlug: () => (locked ? wantSlug : null),
  };
}
