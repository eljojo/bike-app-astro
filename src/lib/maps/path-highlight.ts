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
  /** GeoJSON source ID to query for fly-to bounds */
  sourceId?: string;
  /** Slug → network slug mapping, for framing the whole network on hover */
  slugToNetwork?: Record<string, string>;
  /** Network slug → geo IDs, for computing network bounds */
  networkGeoIds?: Record<string, string[]>;
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
 * Wire up list hover → map path highlight + optional fly-to.
 * List items must have `data-slug` attributes matching the feature property.
 */
export function setupPathHighlight(map: maplibregl.Map, opts: PathHighlightOptions): void {
  const o = { ...DEFAULTS, ...opts };
  let hoveredSlug: string | null = null;
  let flyTimeout: ReturnType<typeof setTimeout> | null = null;

  function highlight(slug: string | null) {
    if (hoveredSlug === slug) return;
    hoveredSlug = slug;

    if (flyTimeout) { clearTimeout(flyTimeout); flyTimeout = null; }

    // If the slug is a network, build a filter matching all its geo IDs
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

    // Fly to path if it's off-screen (debounced to avoid jitter)
    if (slug && o.sourceId) {
      flyTimeout = setTimeout(() => flyToSlug(slug), 300);
    }
  }

  function flyToSlug(slug: string) {
    if (!o.sourceId) return;

    // Determine which geo IDs to frame: network if available, else just the path
    const networkSlug = o.slugToNetwork?.[slug];
    const geoIdsToFrame = (networkSlug && o.networkGeoIds?.[networkSlug]) ?? null;

    // Query rendered features for bounds — works with both GeoJSON and vector tile sources
    const features = map.querySourceFeatures(o.sourceId, {
      filter: geoIdsToFrame
        ? ['in', ['get', 'relationId'], ['literal', geoIdsToFrame]]
        : ['==', ['get', o.property], slug],
    });

    if (features.length === 0) return;

    // Build bounds from all matching feature coordinates
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const f of features) {
      const geom = f.geometry;
      const coords = geom.type === 'LineString' ? (geom as GeoJSON.LineString).coordinates
        : geom.type === 'MultiLineString' ? (geom as GeoJSON.MultiLineString).coordinates.flat()
        : [];
      for (const [lng, lat] of coords as [number, number][]) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }

    if (minLng === Infinity) return;

    // Check if the path is already visible
    const mapBounds = map.getBounds();
    if (mapBounds.contains([minLng, minLat]) && mapBounds.contains([maxLng, maxLat])) return;

    // Ease to show the path/network
    map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
      padding: 60,
      maxZoom: map.getZoom(), // don't zoom in further than current
      animate: true,
      duration: 500,
    });
  }

  document.querySelectorAll<HTMLElement>(o.listSelector).forEach(el => {
    el.addEventListener('mouseenter', () => highlight(el.dataset.slug || null));
    el.addEventListener('mouseleave', () => highlight(null));
  });
}
