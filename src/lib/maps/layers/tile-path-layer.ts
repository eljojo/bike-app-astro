// src/lib/maps/layers/tile-path-layer.ts
import maplibregl from 'maplibre-gl';
import { showPopup } from '../map-init';
import { buildPathPopup } from '../map-helpers';
import { pathForeground, pathBackground, pathDetail, TRAIL_DASH, IS_TRAIL_EXPR } from '../map-swatch';
import { createTileLoader, type TileLoader, type TileManifestEntry } from '../tile-loader';
import type { MapLayer, LayerContext } from './types';

export interface TilePathLayerOptions {
  /** Pre-fetched or pre-resolved manifest entries */
  manifestPromise: Promise<TileManifestEntry[]>;
  /** Base URL for tiles, e.g. '/bike-paths/geo/tiles/' */
  fetchPath: string;
  /** Geo IDs to highlight (detail page mode) */
  highlightGeoIds?: Set<string>;
  /**
   * When true, paths are the main content (not background to routes).
   * Increases line widths, enables popups on all paths (not just hasPage),
   * and uses richer popup content from tile properties.
   */
  foreground?: boolean;
  /** Override which features are interactive (by geoId). When omitted, uses hasPage. */
  interactiveGeoIds?: Set<string>;
  /** Optional slug info for richer popups (vibe, network name, network URL). */
  slugInfo?: Record<string, { name: string; url: string; length_km?: number; surface?: string; path_type?: string; vibe?: string; network?: string; networkUrl?: string }>;
  /** Localized labels for popups. */
  labels?: { viewDetails?: string };
}

export interface TilePathLayer extends MapLayer {
  highlightGeoIds(map: maplibregl.Map, geoIds: string[] | null, fly?: boolean): void;
  fitToGeoIds(map: maplibregl.Map, geoIds: string[]): void;
  /** Query in-memory features by slug or network geoIds. No renderer dependency. */
  queryFeaturesBySlug(slug: string, networkGeoIds?: Record<string, string[]>): GeoJSON.Feature[];
}

const SOURCE_ID = 'paths-network';

/**
 * Tag tile features with highlight/interactive properties for map rendering.
 * Exported for testing — used internally by createTilePathLayer.
 */
export function tagTileFeatures(
  features: GeoJSON.Feature[],
  isDetailMode: boolean,
  highlightGeoIds?: Set<string>,
  interactiveGeoIds?: Set<string>,
): GeoJSON.Feature[] {
  for (const f of features) {
    if (!f.properties) continue;
    const geoId = f.properties._geoId;
    // Always set relationId (needed for highlight layer)
    f.properties.relationId = geoId;

    if (isDetailMode) {
      if (geoId && highlightGeoIds?.has(geoId)) {
        f.properties.highlight = 'true';
      }
      if (f.properties.hasPage) {
        f.properties.interactive = 'true';
      }
    } else if (interactiveGeoIds) {
      f.properties.interactive = interactiveGeoIds.has(geoId) ? 'true' : '';
    } else {
      if (f.properties.hasPage) {
        f.properties.interactive = 'true';
      }
    }
  }
  return features;
}

export function createTilePathLayer(opts: TilePathLayerOptions): TilePathLayer {
  const { manifestPromise, fetchPath, highlightGeoIds, foreground = false, interactiveGeoIds, slugInfo, labels } = opts;
  const isDetailMode = highlightGeoIds != null && highlightGeoIds.size > 0;

  let tileLoader: TileLoader | null = null;
  let layersCreated = false;
  let visible = true;
  let moveEndHandler: (() => void) | null = null;
  let clickHandler: ((e: maplibregl.MapLayerMouseEvent) => void) | null = null;
  let enterHandler: ((e: maplibregl.MapLayerMouseEvent) => void) | null = null;
  let leaveHandler: (() => void) | null = null;

  function tagFeatures(features: GeoJSON.Feature[]) {
    return tagTileFeatures(features, isDetailMode, isDetailMode ? highlightGeoIds : undefined, interactiveGeoIds);
  }

  function removeSourceAndLayers(map: maplibregl.Map) {
    const style = map.getStyle();
    if (style?.layers) {
      for (const layer of style.layers) {
        if ('source' in layer && layer.source === SOURCE_ID && map.getLayer(layer.id)) {
          map.removeLayer(layer.id);
        }
      }
    }
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    layersCreated = false;
  }

  const LINE_LAYERS = ['paths-network-line', 'paths-network-line-dashed'];

  function removeListeners(map: maplibregl.Map) {
    if (moveEndHandler) { map.off('moveend', moveEndHandler); moveEndHandler = null; }
    const allLayers = [...LINE_LAYERS, ...CLICKABLE_LAYERS];
    const seen = new Set<string>();
    for (const id of allLayers) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (clickHandler && map.getLayer(id)) map.off('click', id, clickHandler);
      if (enterHandler && map.getLayer(id)) map.off('mouseenter', id, enterHandler);
      if (leaveHandler && map.getLayer(id)) map.off('mouseleave', id, leaveHandler);
    }
    clickHandler = null;
    enterHandler = null;
    leaveHandler = null;
  }

  function zoomInterp(stops: readonly (readonly [number, number])[]): maplibregl.ExpressionSpecification {
    return ['interpolate', ['linear'], ['zoom'], ...stops.flatMap(([z, v]) => [z, v])] as unknown as maplibregl.ExpressionSpecification;
  }

  const CLICKABLE_LAYERS = ['paths-network-line', 'paths-network-line-dashed', 'paths-network-bg', 'paths-network-bg-dashed', 'paths-network-highlight'];

  function setupLayers(map: maplibregl.Map, features: GeoJSON.Feature[]) {
    if (features.length === 0) return;

    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
    });

    if (isDetailMode) {
      const s = pathDetail;
      // Detail page: very faded context for surrounding paths (solid)
      map.addLayer({
        id: 'paths-network-bg', type: 'line', source: SOURCE_ID,
        filter: ['all', ['!=', ['get', 'highlight'], 'true'], ['!=', IS_TRAIL_EXPR, true]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': s.color, 'line-width': zoomInterp(s.context.width), 'line-opacity': zoomInterp(s.context.opacity) },
      });
      map.addLayer({
        id: 'paths-network-bg-dashed', type: 'line', source: SOURCE_ID,
        filter: ['all', ['!=', ['get', 'highlight'], 'true'], ['==', IS_TRAIL_EXPR, true]],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': s.color, 'line-width': zoomInterp(s.context.width), 'line-opacity': zoomInterp(s.context.opacity), 'line-dasharray': TRAIL_DASH },
      });
      // Highlighted path: bold
      map.addLayer({
        id: 'paths-network-line', type: 'line', source: SOURCE_ID,
        filter: ['all', ['==', ['get', 'highlight'], 'true'], ['!=', IS_TRAIL_EXPR, true]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': s.color, 'line-width': zoomInterp(s.highlighted.width), 'line-opacity': s.highlighted.opacity },
      });
      map.addLayer({
        id: 'paths-network-line-dashed', type: 'line', source: SOURCE_ID,
        filter: ['all', ['==', ['get', 'highlight'], 'true'], ['==', IS_TRAIL_EXPR, true]],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': s.color, 'line-width': zoomInterp(s.highlighted.width), 'line-opacity': s.highlighted.opacity, 'line-dasharray': TRAIL_DASH },
      });
      // Labels on highlighted path
      map.addLayer({
        id: 'paths-network-labels', type: 'symbol', source: SOURCE_ID,
        filter: ['==', ['get', 'highlight'], 'true'],
        minzoom: 11,
        layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-size': 12, 'text-font': ['Open Sans Regular'], 'text-anchor': 'center', 'text-offset': [0, -1], 'text-max-angle': 30, 'symbol-spacing': 300, 'text-allow-overlap': false },
        paint: { 'text-color': s.color, 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
      });
    } else if (foreground) {
      const s = pathForeground;
      // Foreground mode: paths are the main content. Flat widths (dense data).
      map.addLayer({
        id: 'paths-network-bg', type: 'line', source: SOURCE_ID,
        filter: ['all', ['!=', ['get', 'interactive'], 'true'], ['!=', IS_TRAIL_EXPR, true]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': s.color, 'line-width': s.other.width, 'line-opacity': s.other.opacity },
      });
      map.addLayer({
        id: 'paths-network-bg-dashed', type: 'line', source: SOURCE_ID,
        filter: ['all', ['!=', ['get', 'interactive'], 'true'], ['==', IS_TRAIL_EXPR, true]],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': s.color, 'line-width': s.other.width, 'line-opacity': s.other.opacity, 'line-dasharray': TRAIL_DASH },
      });
      map.addLayer({
        id: 'paths-network-line', type: 'line', source: SOURCE_ID,
        filter: ['all', ['==', ['get', 'interactive'], 'true'], ['!=', IS_TRAIL_EXPR, true]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': s.color, 'line-width': s.interactive.width, 'line-opacity': s.interactive.opacity },
      });
      map.addLayer({
        id: 'paths-network-line-dashed', type: 'line', source: SOURCE_ID,
        filter: ['all', ['==', ['get', 'interactive'], 'true'], ['==', IS_TRAIL_EXPR, true]],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': s.color, 'line-width': s.interactive.width, 'line-opacity': s.interactive.opacity, 'line-dasharray': TRAIL_DASH },
      });
      map.addLayer({
        id: 'paths-network-labels', type: 'symbol', source: SOURCE_ID,
        filter: ['==', ['get', 'interactive'], 'true'],
        minzoom: 11,
        layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-size': 12, 'text-font': ['Open Sans Regular'], 'text-anchor': 'center', 'text-offset': [0, -1], 'text-max-angle': 30, 'symbol-spacing': 300, 'text-allow-overlap': false },
        paint: { 'text-color': s.color, 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
      });
      // Highlight layer (for category/network selection from outside)
      map.addLayer({
        id: 'paths-network-highlight', type: 'line', source: SOURCE_ID,
        filter: ['==', ['get', 'relationId'], ''],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': s.color, 'line-width': pathForeground.highlight.width, 'line-opacity': pathForeground.highlight.opacity },
      });
    } else {
      const s = pathBackground;
      // Background mode: paths as context behind route polylines. Zoom-interpolated.
      map.addLayer({
        id: 'paths-network-bg', type: 'line', source: SOURCE_ID,
        filter: ['all', ['!=', ['get', 'interactive'], 'true'], ['!=', IS_TRAIL_EXPR, true]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': s.color, 'line-width': zoomInterp(s.other.width), 'line-opacity': zoomInterp(s.other.opacity) },
      });
      map.addLayer({
        id: 'paths-network-bg-dashed', type: 'line', source: SOURCE_ID,
        filter: ['all', ['!=', ['get', 'interactive'], 'true'], ['==', IS_TRAIL_EXPR, true]],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': s.color, 'line-width': zoomInterp(s.other.width), 'line-opacity': zoomInterp(s.other.opacity), 'line-dasharray': TRAIL_DASH },
      });
      map.addLayer({
        id: 'paths-network-line', type: 'line', source: SOURCE_ID,
        filter: ['all', ['==', ['get', 'interactive'], 'true'], ['!=', IS_TRAIL_EXPR, true]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': s.color, 'line-width': zoomInterp(s.interactive.width), 'line-opacity': s.interactive.opacity },
      });
      map.addLayer({
        id: 'paths-network-line-dashed', type: 'line', source: SOURCE_ID,
        filter: ['all', ['==', ['get', 'interactive'], 'true'], ['==', IS_TRAIL_EXPR, true]],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': s.color, 'line-width': zoomInterp(s.interactive.width), 'line-opacity': s.interactive.opacity, 'line-dasharray': TRAIL_DASH },
      });
      map.addLayer({
        id: 'paths-network-labels', type: 'symbol', source: SOURCE_ID,
        filter: ['==', ['get', 'interactive'], 'true'],
        minzoom: 11,
        layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-size': 12, 'text-font': ['Open Sans Regular'], 'text-anchor': 'center', 'text-offset': [0, -1], 'text-max-angle': 30, 'symbol-spacing': 300, 'text-allow-overlap': false },
        paint: { 'text-color': s.color, 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
      });
    }

    // Click popup — in foreground mode, all paths are clickable (not just hasPage).
    // Uses shared buildPathPopup for consistent rendering.
    // TODO: some features (e.g. Ottawa River Pathway) open an empty popup —
    // likely a geo-metadata mapping gap where the tile feature has no name/slug.
    // Investigate which geoIds are missing metadata in generate-geo-metadata.ts.
    function hasPopupData(props: Record<string, unknown>): boolean {
      return !!(props.name);
    }

    clickHandler = (e) => {
      if (!e.features?.length) return;
      const props = e.features[0].properties!;
      if (!foreground && props.hasPage !== 'true') return;
      if (!hasPopupData(props)) return;

      const slug = props.slug as string || '';
      const info = slugInfo?.[slug];
      if (info) {
        const content = buildPathPopup({
          name: info.name, url: info.url,
          length_km: info.length_km, surface: info.surface,
          path_type: info.path_type, vibe: info.vibe,
          network: info.network, networkUrl: info.networkUrl,
        }, labels);
        showPopup(map, new maplibregl.Popup({ closeButton: true, maxWidth: '280px' })
          .setLngLat(e.lngLat).setHTML(content));
        return;
      }

      // Fallback: build popup from tile properties
      const name = props.name || '';
      const memberOf = props.memberOf || '';
      let pathUrl = '';
      if (slug && (props.hasPage === true || props.hasPage === 'true')) {
        pathUrl = memberOf ? `/bike-paths/${memberOf}/${slug}` : `/bike-paths/${slug}`;
      } else if (memberOf) {
        pathUrl = `/bike-paths/${memberOf}`;
      }
      const content = buildPathPopup({
        name,
        url: pathUrl || undefined,
        length_km: props.length_km || undefined,
        surface: props.surface || undefined,
        path_type: props.path_type || undefined,
      }, labels);

      showPopup(map, new maplibregl.Popup({ closeButton: true, maxWidth: '280px' })
        .setLngLat(e.lngLat).setHTML(content));
    };
    // In foreground mode, attach click handlers to ALL layers (including bg)
    const clickLayers = foreground ? CLICKABLE_LAYERS : LINE_LAYERS;
    for (const id of clickLayers) {
      if (map.getLayer(id)) map.on('click', id, clickHandler);
    }

    enterHandler = (e: maplibregl.MapLayerMouseEvent) => {
      if (!e.features?.length) return;
      const props = e.features[0].properties!;
      const slug = props.slug as string;
      if ((slug && slugInfo?.[slug]) || hasPopupData(props)) {
        map.getCanvas().style.cursor = 'pointer';
      }
    };
    leaveHandler = () => { map.getCanvas().style.cursor = ''; };
    const hoverLayers = foreground ? CLICKABLE_LAYERS : LINE_LAYERS;
    for (const id of hoverLayers) {
      if (map.getLayer(id)) {
        map.on('mouseenter', id, enterHandler);
        map.on('mouseleave', id, leaveHandler);
      }
    }

    layersCreated = true;
  }

  const layer: TilePathLayer = {
    id: 'tile-paths',
    hasContent: true,

    async setup(ctx: LayerContext) {
      const { map } = ctx;

      if (!tileLoader) {
        const manifest = await manifestPromise;
        if (!ctx.isCurrent()) return;
        tileLoader = createTileLoader(manifest, fetchPath);
      }

      const b = map.getBounds();
      const features = await tileLoader.loadTilesForBounds([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      if (!ctx.isCurrent()) return;
      tagFeatures(features);

      setupLayers(map, features);

      moveEndHandler = async () => {
        if (!visible || !tileLoader || !layersCreated) return;
        const prevCount = tileLoader.allLoadedFeatures().length;
        const bounds = map.getBounds();
        const newFeatures = await tileLoader.loadTilesForBounds([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]);
        if (newFeatures.length > prevCount) {
          tagFeatures(newFeatures);
          const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
          if (source) {
            source.setData({ type: 'FeatureCollection', features: tileLoader.allLoadedFeatures() });
          }
        }
      };
      map.on('moveend', moveEndHandler);
    },

    teardown(map: maplibregl.Map) {
      removeListeners(map);
      removeSourceAndLayers(map);
    },

    getBounds() {
      if (!tileLoader) return null;
      const features = tileLoader.allLoadedFeatures();
      const bounds = new maplibregl.LngLatBounds();
      for (const f of features) {
        // In detail mode, only include highlighted features
        if (isDetailMode && f.properties?._geoId && !highlightGeoIds!.has(f.properties._geoId)) continue;
        const geom = f.geometry;
        const coords = geom.type === 'LineString' ? (geom as GeoJSON.LineString).coordinates
          : geom.type === 'MultiLineString' ? (geom as GeoJSON.MultiLineString).coordinates.flat()
          : [];
        for (const c of coords) bounds.extend(c as [number, number]);
      }
      return bounds.isEmpty() ? null : bounds;
    },

    setVisible(map: maplibregl.Map, v: boolean) {
      visible = v;
      const vis = v ? 'visible' : 'none';
      for (const id of ['paths-network-bg', 'paths-network-bg-dashed', 'paths-network-line', 'paths-network-line-dashed', 'paths-network-labels', 'paths-network-highlight']) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
      }
    },

    highlightGeoIds(map: maplibregl.Map, geoIds: string[] | null, fly = false) {
      if (!map.getLayer('paths-network-highlight')) return;
      if (geoIds && geoIds.length > 0) {
        map.setFilter('paths-network-highlight', ['in', ['get', 'relationId'], ['literal', geoIds]]);
        for (const id of ['paths-network-line', 'paths-network-line-dashed']) {
          if (map.getLayer(id)) map.setPaintProperty(id, 'line-opacity', pathForeground.highlight.dimInteractive);
        }
        for (const id of ['paths-network-bg', 'paths-network-bg-dashed']) {
          if (map.getLayer(id)) map.setPaintProperty(id, 'line-opacity', pathForeground.highlight.dimOther);
        }
        if (fly) this.fitToGeoIds(map, geoIds);
      } else {
        map.setFilter('paths-network-highlight', ['==', ['get', 'relationId'], '']);
        for (const id of ['paths-network-line', 'paths-network-line-dashed']) {
          if (map.getLayer(id)) map.setPaintProperty(id, 'line-opacity', pathForeground.interactive.opacity);
        }
        for (const id of ['paths-network-bg', 'paths-network-bg-dashed']) {
          if (map.getLayer(id)) map.setPaintProperty(id, 'line-opacity', pathForeground.other.opacity);
        }
      }
    },

    fitToGeoIds(map: maplibregl.Map, geoIds: string[]) {
      // Use in-memory features from tileLoader instead of querySourceFeatures.
      // querySourceFeatures depends on the renderer having processed the GeoJSON
      // into internal tiles, which may not have happened yet after addSource().
      if (!tileLoader) return;
      const geoIdSet = new Set(geoIds);
      const features = tileLoader.allLoadedFeatures().filter(
        f => f.properties?.relationId && geoIdSet.has(f.properties.relationId),
      );
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
    },

    queryFeaturesBySlug(slug: string, netGeoIds?: Record<string, string[]>) {
      if (!tileLoader) return [];
      const all = tileLoader.allLoadedFeatures();
      const isNetwork = netGeoIds?.[slug];
      if (isNetwork) {
        const ids = new Set(netGeoIds![slug]);
        return all.filter(f => f.properties?.relationId && ids.has(f.properties.relationId));
      }
      return all.filter(f => f.properties?.slug === slug);
    },
  };

  return layer;
}
