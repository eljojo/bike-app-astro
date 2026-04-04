// src/lib/maps/layers/place-layer.ts
import maplibregl from 'maplibre-gl';
import { showPopup } from '../map-init';
import type { MapLayer, LayerContext } from './types';
import type { MarkerOptions } from '../map-init';

export interface PlaceLayerOptions {
  places: MarkerOptions[];
  defaultVisible?: boolean;
}

const SOURCE_ID = 'place-markers';
const LAYER_IDS = ['place-clusters', 'place-cluster-count', 'place-unclustered'];

export function createPlaceLayer(opts: PlaceLayerOptions): MapLayer {
  const { places, defaultVisible = true } = opts;

  let syncHandler: (() => void) | null = null;
  let clusterClickHandler: ((e: maplibregl.MapLayerMouseEvent) => void) | null = null;
  let enterHandler: (() => void) | null = null;
  let leaveHandler: (() => void) | null = null;
  const emojiMarkers = new Map<string, maplibregl.Marker>();
  let visible = defaultVisible;

  function removeAllDomMarkers() {
    for (const [, marker] of emojiMarkers) marker.remove();
    emojiMarkers.clear();
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
  }

  function removeListeners(map: maplibregl.Map) {
    if (syncHandler) { map.off('idle', syncHandler); syncHandler = null; }
    if (clusterClickHandler && map.getLayer('place-clusters')) {
      map.off('click', 'place-clusters', clusterClickHandler);
      clusterClickHandler = null;
    }
    if (enterHandler && map.getLayer('place-clusters')) {
      map.off('mouseenter', 'place-clusters', enterHandler);
      enterHandler = null;
    }
    if (leaveHandler && map.getLayer('place-clusters')) {
      map.off('mouseleave', 'place-clusters', leaveHandler);
      leaveHandler = null;
    }
  }

  return {
    id: 'places',
    hasContent: places.length > 0,

    setup(ctx: LayerContext) {
      const { map } = ctx;

      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: places.map(m => ({
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [m.lng, m.lat] },
            properties: { emoji: m.emoji, popup: m.popup },
          })),
        },
        cluster: true,
        clusterRadius: 30,
        clusterMaxZoom: 12,
      });

      map.addLayer({
        id: 'place-clusters',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#ffffff',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 12, 15, 18],
          'circle-stroke-color': '#cccccc',
          'circle-stroke-width': 2,
        },
      });

      map.addLayer({
        id: 'place-cluster-count',
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': ['NotoSans_Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 15, 13],
        },
        paint: { 'text-color': '#555555' },
      });

      map.addLayer({
        id: 'place-unclustered',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        paint: { 'circle-radius': 1, 'circle-opacity': 0 },
      });

      // DOM emoji markers synced on idle
      syncHandler = () => {
        const features = map.queryRenderedFeatures({ layers: ['place-unclustered'] });
        const seen = new Set<string>();

        for (const f of features) {
          const props = f.properties!;
          const key = `${(f.geometry as GeoJSON.Point).coordinates.join(',')}`;
          if (seen.has(key)) continue;
          seen.add(key);

          if (!emojiMarkers.has(key)) {
            const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
            const el = document.createElement('div');
            el.className = 'poi-marker';
            el.style.cursor = 'pointer';
            el.innerHTML = `<span class="poi-marker-emoji">${props.emoji}</span>`;

            const popup = new maplibregl.Popup({ offset: 20, maxWidth: '320px' }).setHTML(props.popup);
            el.addEventListener('click', (e) => {
              e.stopPropagation();
              popup.setLngLat(coords);
              showPopup(map, popup);
            });

            const marker = new maplibregl.Marker({ element: el }).setLngLat(coords).addTo(map);
            emojiMarkers.set(key, marker);
          }
        }

        for (const [key, marker] of emojiMarkers) {
          if (!seen.has(key)) {
            marker.remove();
            emojiMarkers.delete(key);
          }
        }
      };
      map.on('idle', syncHandler);

      // Click cluster to zoom
      clusterClickHandler = async (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['place-clusters'] });
        if (!features.length) return;
        const clusterId = features[0].properties?.cluster_id;
        const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource;
        const zoom = await source.getClusterExpansionZoom(clusterId);
        map.easeTo({ center: (features[0].geometry as GeoJSON.Point).coordinates as [number, number], zoom });
      };
      map.on('click', 'place-clusters', clusterClickHandler);

      enterHandler = () => { map.getCanvas().style.cursor = 'pointer'; };
      leaveHandler = () => { map.getCanvas().style.cursor = ''; };
      map.on('mouseenter', 'place-clusters', enterHandler);
      map.on('mouseleave', 'place-clusters', leaveHandler);

      // Apply initial visibility
      if (!visible) this.setVisible!(map, false);
    },

    teardown(map: maplibregl.Map) {
      removeListeners(map);
      removeAllDomMarkers();
      removeSourceAndLayers(map);
    },

    setVisible(map: maplibregl.Map, v: boolean) {
      visible = v;
      const vis = v ? 'visible' : 'none';
      for (const id of LAYER_IDS) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
      }
      const markers = map.getContainer().querySelectorAll('.poi-marker');
      for (const el of markers) {
        (el as HTMLElement).style.display = v ? '' : 'none';
      }
    },
  };
}
