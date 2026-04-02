// src/lib/maps/path-highlight.ts
//
// Shared list↔map hover highlight for bike path pages.
// Works with both GeoJSON layers (network detail) and tile layers (paths index).
import type maplibregl from 'maplibre-gl';

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
}

const DEFAULTS = {
  property: 'slug',
  lineWidth: 6,
  lineWidthHover: 8,
  lineOpacity: 0.85,
  lineOpacityHover: 1,
  lineOpacityDim: 0.3,
};

/**
 * Wire up list hover → map path highlight.
 * List items must have `data-slug` attributes matching the feature property.
 */
export function setupPathHighlight(map: maplibregl.Map, opts: PathHighlightOptions): void {
  const o = { ...DEFAULTS, ...opts };
  let hoveredSlug: string | null = null;

  function highlight(slug: string | null) {
    if (hoveredSlug === slug) return;
    hoveredSlug = slug;

    for (const layerId of o.layerIds) {
      if (!map.getLayer(layerId)) continue;

      if (slug) {
        map.setPaintProperty(layerId, 'line-width', [
          'case',
          ['==', ['get', o.property], slug],
          o.lineWidthHover,
          o.lineWidth,
        ]);
        map.setPaintProperty(layerId, 'line-opacity', [
          'case',
          ['==', ['get', o.property], slug],
          o.lineOpacityHover,
          o.lineOpacityDim,
        ]);
      } else {
        map.setPaintProperty(layerId, 'line-width', o.lineWidth);
        map.setPaintProperty(layerId, 'line-opacity', o.lineOpacity);
      }
    }
  }

  document.querySelectorAll<HTMLElement>(o.listSelector).forEach(el => {
    el.addEventListener('mouseenter', () => highlight(el.dataset.slug || null));
    el.addEventListener('mouseleave', () => highlight(null));
  });
}
