// src/lib/maps/layers/polyline-layer.ts
import maplibregl from 'maplibre-gl';
import {
  buildPolylineFeature,
  getRouteColor,
  ROUTE_LINE_WIDTH,
  showPopup,
} from '../map-init';
import type { MapLayer, LayerContext } from './types';
import type { PolylineOptions } from '../map-init';

export interface PolylineLayerOptions {
  polylines: PolylineOptions[];
}

const SOURCE_ID = 'route-polylines';
const LINE_LAYER_ID = 'route-lines';

export interface PolylineLayer extends MapLayer {
  /** Replace the polyline source data. Used by route:toggle to hide/show individual routes. */
  updateData(features: GeoJSON.Feature[]): void;
  /** Set a filter on the line layer. Used by route:toggle to hide features marked as hidden. */
  setFilter(filter: maplibregl.FilterSpecification | null): void;
}

export function createPolylineLayer(opts: PolylineLayerOptions): PolylineLayer {
  let bounds: maplibregl.LngLatBounds | null = null;

  // Track listeners for cleanup
  let clickHandler: ((e: maplibregl.MapLayerMouseEvent) => void) | null = null;
  let enterHandler: (() => void) | null = null;
  let leaveHandler: (() => void) | null = null;

  function removeListeners(map: maplibregl.Map) {
    if (clickHandler && map.getLayer(LINE_LAYER_ID)) {
      map.off('click', LINE_LAYER_ID, clickHandler);
    }
    if (enterHandler && map.getLayer(LINE_LAYER_ID)) {
      map.off('mouseenter', LINE_LAYER_ID, enterHandler);
    }
    if (leaveHandler && map.getLayer(LINE_LAYER_ID)) {
      map.off('mouseleave', LINE_LAYER_ID, leaveHandler);
    }
    clickHandler = null;
    enterHandler = null;
    leaveHandler = null;
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
    if (map.getSource(SOURCE_ID)) {
      map.removeSource(SOURCE_ID);
    }
  }

  let currentMap: maplibregl.Map | null = null;

  return {
    id: 'polylines',
    hasContent: opts.polylines.length > 0,

    setup(ctx: LayerContext) {
      const { map, styleKey } = ctx;
      currentMap = map;

      const features = opts.polylines.map(p => buildPolylineFeature(p.encoded, p.popup, p.color));
      const hasPerPolylineColors = opts.polylines.some(p => p.color);

      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      });

      map.addLayer({
        id: LINE_LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        paint: {
          'line-color': hasPerPolylineColors
            ? ['coalesce', ['get', 'color'], getRouteColor(styleKey)]
            : getRouteColor(styleKey),
          'line-width': ROUTE_LINE_WIDTH,
          'line-opacity': 0.9,
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });

      clickHandler = (e) => {
        if (!e.features?.length) return;
        const props = e.features[0].properties;
        if (props?.popup) {
          showPopup(map, new maplibregl.Popup().setLngLat(e.lngLat).setHTML(props.popup));
        }
      };
      map.on('click', LINE_LAYER_ID, clickHandler);

      enterHandler = () => { map.getCanvas().style.cursor = 'pointer'; };
      leaveHandler = () => { map.getCanvas().style.cursor = ''; };
      map.on('mouseenter', LINE_LAYER_ID, enterHandler);
      map.on('mouseleave', LINE_LAYER_ID, leaveHandler);

      bounds = null;
      if (features.length > 0) {
        bounds = new maplibregl.LngLatBounds();
        for (const f of features) {
          for (const coord of f.geometry.coordinates) {
            bounds.extend(coord as [number, number]);
          }
        }
      }
    },

    teardown(map: maplibregl.Map) {
      removeListeners(map);
      removeSourceAndLayers(map);
      currentMap = null;
    },

    setVisible(map: maplibregl.Map, visible: boolean) {
      const vis = visible ? 'visible' : 'none';
      const style = map.getStyle();
      if (style?.layers) {
        for (const layer of style.layers) {
          if ('source' in layer && layer.source === SOURCE_ID) {
            map.setLayoutProperty(layer.id, 'visibility', vis);
          }
        }
      }
    },

    getBounds() {
      return bounds;
    },

    updateData(features: GeoJSON.Feature[]) {
      if (!currentMap) return;
      const source = currentMap.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData({ type: 'FeatureCollection', features });
      }
      // Recalculate bounds from the new features
      bounds = null;
      if (features.length > 0) {
        bounds = new maplibregl.LngLatBounds();
        for (const f of features) {
          const geom = f.geometry as GeoJSON.LineString;
          if (geom.coordinates) {
            for (const coord of geom.coordinates) {
              bounds.extend(coord as [number, number]);
            }
          }
        }
      }
    },

    setFilter(filter: maplibregl.FilterSpecification | null) {
      if (!currentMap) return;
      if (currentMap.getLayer(LINE_LAYER_ID)) {
        currentMap.setFilter(LINE_LAYER_ID, filter);
      }
    },
  };
}
