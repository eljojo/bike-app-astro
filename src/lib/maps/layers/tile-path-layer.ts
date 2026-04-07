// src/lib/maps/layers/tile-path-layer.ts
import maplibregl from 'maplibre-gl';
import { ROUTE_COLOR, ROUTE_LINE_WIDTH, showPopup } from '../map-init';
import { buildPathPopup } from '../map-helpers';
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
): GeoJSON.Feature[] {
  for (const f of features) {
    if (!f.properties) continue;
    const geoId = f.properties._geoId;
    if (isDetailMode) {
      if (geoId && highlightGeoIds?.has(geoId)) {
        f.properties.highlight = 'true';
      }
      if (f.properties.hasPage) {
        f.properties.interactive = 'true';
      }
    } else {
      if (f.properties.hasPage) {
        f.properties.interactive = 'true';
      }
    }
  }
  return features;
}

export function createTilePathLayer(opts: TilePathLayerOptions): MapLayer {
  const { manifestPromise, fetchPath, highlightGeoIds, foreground = false } = opts;
  const isDetailMode = highlightGeoIds != null && highlightGeoIds.size > 0;

  let tileLoader: TileLoader | null = null;
  let layersCreated = false;
  let visible = true;
  let moveEndHandler: (() => void) | null = null;
  let clickHandler: ((e: maplibregl.MapLayerMouseEvent) => void) | null = null;
  let enterHandler: ((e: maplibregl.MapLayerMouseEvent) => void) | null = null;
  let leaveHandler: (() => void) | null = null;

  function tagFeatures(features: GeoJSON.Feature[]) {
    return tagTileFeatures(features, isDetailMode, isDetailMode ? highlightGeoIds : undefined);
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

  // Line widths depend on whether paths are foreground (main content) or
  // background (context for routes). Foreground uses flat widths (dense data),
  // background uses zoom-interpolated widths.
  const FG_WIDTH_INTERACTIVE = 4;
  const FG_OPACITY_INTERACTIVE = 0.8;
  const FG_WIDTH_BG = 2.5;
  const FG_OPACITY_BG = 0.1;
  const BG_WIDTH_INTERACTIVE: [number, number][] = [[8, 2], [12, 4], [14, ROUTE_LINE_WIDTH]];
  const BG_WIDTH_NON_INTERACTIVE: [number, number][] = [[8, 1], [12, 2], [14, 4]];

  const CLICKABLE_LAYERS = ['paths-network-line', 'paths-network-line-dashed', 'paths-network-bg', 'paths-network-bg-dashed'];

  function setupLayers(map: maplibregl.Map, features: GeoJSON.Feature[]) {
    if (features.length === 0) return;

    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
    });

    const TRAIL_DASH: [number, number] = [3, 1];

    if (isDetailMode) {
      // Detail page: very faded context for surrounding paths (solid)
      map.addLayer({
        id: 'paths-network-bg', type: 'line', source: SOURCE_ID,
        filter: ['all', ['!=', ['get', 'highlight'], 'true'], ['!=', ['in', ['get', 'path_type'], ['literal', ['trail', 'mtb-trail']]], true]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ROUTE_COLOR,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 12, 1, 14, 2],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.04, 12, 0.08, 14, 0.15],
        },
      });
      // Detail page: very faded context for surrounding trails (dashed)
      map.addLayer({
        id: 'paths-network-bg-dashed', type: 'line', source: SOURCE_ID,
        filter: ['all', ['!=', ['get', 'highlight'], 'true'], ['==', ['in', ['get', 'path_type'], ['literal', ['trail', 'mtb-trail']]], true]],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': ROUTE_COLOR,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 12, 1, 14, 2],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.04, 12, 0.08, 14, 0.15],
          'line-dasharray': TRAIL_DASH,
        },
      });

      // Highlighted path: bold (solid)
      map.addLayer({
        id: 'paths-network-line', type: 'line', source: SOURCE_ID,
        filter: ['all', ['==', ['get', 'highlight'], 'true'], ['!=', ['in', ['get', 'path_type'], ['literal', ['trail', 'mtb-trail']]], true]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ROUTE_COLOR,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 12, 4, 14, ROUTE_LINE_WIDTH],
          'line-opacity': 0.8,
        },
      });
      // Highlighted trail: bold (dashed)
      map.addLayer({
        id: 'paths-network-line-dashed', type: 'line', source: SOURCE_ID,
        filter: ['all', ['==', ['get', 'highlight'], 'true'], ['==', ['in', ['get', 'path_type'], ['literal', ['trail', 'mtb-trail']]], true]],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': ROUTE_COLOR,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 12, 4, 14, ROUTE_LINE_WIDTH],
          'line-opacity': 0.8,
          'line-dasharray': TRAIL_DASH,
        },
      });

      // Labels on highlighted path
      map.addLayer({
        id: 'paths-network-labels', type: 'symbol', source: SOURCE_ID,
        filter: ['==', ['get', 'highlight'], 'true'],
        minzoom: 11,
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'name'],
          'text-size': 12,
          'text-font': ['Open Sans Regular'],
          'text-anchor': 'center',
          'text-offset': [0, -1],
          'text-max-angle': 30,
          'symbol-spacing': 300,
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': ROUTE_COLOR,
          'text-halo-color': '#ffffff',
          'text-halo-width': 2,
        },
      });
    } else if (foreground) {
      // Foreground mode: paths are the main content. Thinner lines (data is dense),
      // but all visible. No zoom interpolation — flat widths for consistency.

      // Non-interactive: solid
      map.addLayer({
        id: 'paths-network-bg', type: 'line', source: SOURCE_ID,
        filter: ['all', ['!=', ['get', 'interactive'], 'true'], ['!=', ['in', ['get', 'path_type'], ['literal', ['trail', 'mtb-trail']]], true]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ROUTE_COLOR, 'line-width': FG_WIDTH_BG, 'line-opacity': FG_OPACITY_BG },
      });
      // Non-interactive: dashed
      map.addLayer({
        id: 'paths-network-bg-dashed', type: 'line', source: SOURCE_ID,
        filter: ['all', ['!=', ['get', 'interactive'], 'true'], ['==', ['in', ['get', 'path_type'], ['literal', ['trail', 'mtb-trail']]], true]],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': ROUTE_COLOR, 'line-width': FG_WIDTH_BG, 'line-opacity': FG_OPACITY_BG, 'line-dasharray': TRAIL_DASH },
      });
      // Interactive: solid
      map.addLayer({
        id: 'paths-network-line', type: 'line', source: SOURCE_ID,
        filter: ['all', ['==', ['get', 'interactive'], 'true'], ['!=', ['in', ['get', 'path_type'], ['literal', ['trail', 'mtb-trail']]], true]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ROUTE_COLOR, 'line-width': FG_WIDTH_INTERACTIVE, 'line-opacity': FG_OPACITY_INTERACTIVE },
      });
      // Interactive: dashed
      map.addLayer({
        id: 'paths-network-line-dashed', type: 'line', source: SOURCE_ID,
        filter: ['all', ['==', ['get', 'interactive'], 'true'], ['==', ['in', ['get', 'path_type'], ['literal', ['trail', 'mtb-trail']]], true]],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': ROUTE_COLOR, 'line-width': FG_WIDTH_INTERACTIVE, 'line-opacity': FG_OPACITY_INTERACTIVE, 'line-dasharray': TRAIL_DASH },
      });
      // Labels on interactive paths
      map.addLayer({
        id: 'paths-network-labels', type: 'symbol', source: SOURCE_ID,
        filter: ['==', ['get', 'interactive'], 'true'],
        minzoom: 11,
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'name'],
          'text-size': 12,
          'text-font': ['Open Sans Regular'],
          'text-anchor': 'center',
          'text-offset': [0, -1],
          'text-max-angle': 30,
          'symbol-spacing': 300,
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': ROUTE_COLOR,
          'text-halo-color': '#ffffff',
          'text-halo-width': 2,
        },
      });
    } else {
      // Background mode: paths as context behind route polylines.
      // Zoom-interpolated widths, faded non-interactive.

      // Non-interactive: solid
      map.addLayer({
        id: 'paths-network-bg', type: 'line', source: SOURCE_ID,
        filter: ['all', ['!=', ['get', 'interactive'], 'true'], ['!=', ['in', ['get', 'path_type'], ['literal', ['trail', 'mtb-trail']]], true]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ROUTE_COLOR,
          'line-width': ['interpolate', ['linear'], ['zoom'], ...BG_WIDTH_NON_INTERACTIVE.flat()],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.08, 12, 0.2, 14, 0.45],
        },
      });
      // Non-interactive trails (dashed)
      map.addLayer({
        id: 'paths-network-bg-dashed', type: 'line', source: SOURCE_ID,
        filter: ['all', ['!=', ['get', 'interactive'], 'true'], ['==', ['in', ['get', 'path_type'], ['literal', ['trail', 'mtb-trail']]], true]],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': ROUTE_COLOR,
          'line-width': ['interpolate', ['linear'], ['zoom'], ...BG_WIDTH_NON_INTERACTIVE.flat()],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.08, 12, 0.2, 14, 0.45],
          'line-dasharray': TRAIL_DASH,
        },
      });

      // Interactive paths: bold (solid)
      map.addLayer({
        id: 'paths-network-line', type: 'line', source: SOURCE_ID,
        filter: ['all', ['==', ['get', 'interactive'], 'true'], ['!=', ['in', ['get', 'path_type'], ['literal', ['trail', 'mtb-trail']]], true]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ROUTE_COLOR,
          'line-width': ['interpolate', ['linear'], ['zoom'], ...BG_WIDTH_INTERACTIVE.flat()],
          'line-opacity': 0.8,
        },
      });
      // Interactive trails: bold (dashed)
      map.addLayer({
        id: 'paths-network-line-dashed', type: 'line', source: SOURCE_ID,
        filter: ['all', ['==', ['get', 'interactive'], 'true'], ['==', ['in', ['get', 'path_type'], ['literal', ['trail', 'mtb-trail']]], true]],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': ROUTE_COLOR,
          'line-width': ['interpolate', ['linear'], ['zoom'], ...BG_WIDTH_INTERACTIVE.flat()],
          'line-opacity': 0.8,
          'line-dasharray': TRAIL_DASH,
        },
      });

      // Labels on interactive paths
      map.addLayer({
        id: 'paths-network-labels', type: 'symbol', source: SOURCE_ID,
        filter: ['==', ['get', 'interactive'], 'true'],
        minzoom: 11,
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'name'],
          'text-size': 12,
          'text-font': ['Open Sans Regular'],
          'text-anchor': 'center',
          'text-offset': [0, -1],
          'text-max-angle': 30,
          'symbol-spacing': 300,
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': ROUTE_COLOR,
          'text-halo-color': '#ffffff',
          'text-halo-width': 2,
        },
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
      const name = props.name || '';
      const memberOf = props.memberOf || '';
      const slug = props.slug || '';

      // If the path has its own page, link to it.
      // If it belongs to a network but has no page, link to the network.
      let pathUrl = '';
      if (slug && props.hasPage === true || props.hasPage === 'true') {
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
      });

      showPopup(map, new maplibregl.Popup({ closeButton: true, maxWidth: '280px' })
        .setLngLat(e.lngLat)
        .setHTML(content));
    };
    // In foreground mode, attach click handlers to ALL layers (including bg)
    const clickLayers = foreground ? CLICKABLE_LAYERS : LINE_LAYERS;
    for (const id of clickLayers) {
      if (map.getLayer(id)) map.on('click', id, clickHandler);
    }

    enterHandler = (e: maplibregl.MapLayerMouseEvent) => {
      if (e.features?.length && hasPopupData(e.features[0].properties!)) {
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

  return {
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
      for (const id of ['paths-network-bg', 'paths-network-bg-dashed', 'paths-network-line', 'paths-network-line-dashed', 'paths-network-labels']) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
      }
    },
  };
}
