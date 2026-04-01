// src/lib/maps/layers/waypoint-layer.ts
import maplibregl from 'maplibre-gl';
import type { MapLayer, LayerContext } from './types';

export interface WaypointMarkerData {
  lat: number;
  lng: number;
  type: string;
  label: string;
  popup?: string;
}

export interface WaypointLayerOptions {
  waypoints: WaypointMarkerData[];
}

export function createWaypointLayer(opts: WaypointLayerOptions): MapLayer {
  const markers: maplibregl.Marker[] = [];

  return {
    id: 'waypoints',
    hasContent: opts.waypoints.length > 0,

    setup(ctx: LayerContext) {
      const { map } = ctx;
      for (const wp of opts.waypoints) {
        const el = document.createElement('div');
        el.className = `waypoint-marker waypoint-marker--${wp.type}`;
        const marker = new maplibregl.Marker({ element: el }).setLngLat([wp.lng, wp.lat]).addTo(map);
        if (wp.popup) {
          marker.setPopup(new maplibregl.Popup({ offset: 14, maxWidth: '300px' }).setHTML(wp.popup));
        } else {
          el.title = wp.label;
        }
        markers.push(marker);
      }
    },

    teardown(_map: maplibregl.Map) {
      for (const m of markers) m.remove();
      markers.length = 0;
    },
  };
}
