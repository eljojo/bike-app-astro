// src/lib/maps/layers/geojson-line-layer.ts
import maplibregl from 'maplibre-gl';
import { ROUTE_COLOR, ROUTE_LINE_WIDTH } from '../map-init';
import type { MapLayer, LayerContext } from './types';

export interface GeojsonLineLayerOptions {
  /** GeoJSON filenames to fetch */
  geoFiles: string[];
  /** Base URL path, e.g. '/bike-paths/geo/' */
  fetchPath: string;
  /** Optional mapping from geo filename to slug — enriches features for highlight */
  slugMap?: Record<string, string>;
}

const SOURCE_ID = 'bike-path';
const LINE_LAYER_ID = 'bike-path-line';

export function createGeojsonLineLayer(opts: GeojsonLineLayerOptions): MapLayer {
  const { geoFiles, fetchPath, slugMap } = opts;

  let cachedFeatures: GeoJSON.Feature[] | null = null;
  let bounds: maplibregl.LngLatBounds | null = null;

  function removeSourceAndLayers(map: maplibregl.Map) {
    if (map.getLayer(LINE_LAYER_ID)) map.removeLayer(LINE_LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  }

  return {
    id: 'geojson-lines',
    hasContent: geoFiles.length > 0,

    async setup(ctx: LayerContext) {
      const { map } = ctx;
      if (geoFiles.length === 0) return;

      // Fetch once, cache for replay
      if (!cachedFeatures) {
        const features: GeoJSON.Feature[] = [];
        const b = new maplibregl.LngLatBounds();
        for (const file of geoFiles) {
          try {
            const res = await fetch(`${fetchPath}${file}`);
            if (!ctx.isCurrent()) return; // style switch during fetch
            if (!res.ok) continue;
            const geojson = await res.json();
            if (!ctx.isCurrent()) return;
            const fileSlug = slugMap?.[file];
            for (const feature of geojson.features) {
              if (fileSlug) {
                feature.properties = { ...feature.properties, slug: fileSlug };
              }
              features.push(feature);
              if (feature.geometry.type === 'LineString') {
                for (const coord of feature.geometry.coordinates) {
                  b.extend(coord as [number, number]);
                }
              }
            }
          } catch { /* geometry not cached yet */ }
        }
        cachedFeatures = features;
        if (!b.isEmpty()) bounds = b;
      }

      if (cachedFeatures.length === 0) return;

      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: cachedFeatures },
      });

      map.addLayer({
        id: LINE_LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ROUTE_COLOR,
          'line-width': ROUTE_LINE_WIDTH,
          'line-opacity': 0.85,
        },
      });

      if (bounds && !bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 30, animate: false });
      }
    },

    teardown(map: maplibregl.Map) {
      removeSourceAndLayers(map);
      // cachedFeatures intentionally kept — no need to re-fetch after style switch
    },

    getBounds() {
      return bounds;
    },
  };
}
