// src/lib/maps/layers/gps-layer.ts
import maplibregl from 'maplibre-gl';
import type { MapLayer, LayerContext } from './types';

export function createGpsLayer(): MapLayer {
  let gpsMarker: maplibregl.Marker | null = null;
  let active = false;

  return {
    id: 'gps',
    hasContent: true,

    setup(_ctx: LayerContext) {
      // no-op: GPS interaction happens via setVisible
    },

    teardown(_map: maplibregl.Map) {
      if (gpsMarker) { gpsMarker.remove(); gpsMarker = null; }
      active = false;
    },

    setVisible(map: maplibregl.Map, v: boolean) {
      active = v;
      if (v) {
        if (!('geolocation' in navigator)) return;
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (!active) return;
            const { longitude, latitude } = pos.coords;
            if (!gpsMarker) {
              const el = document.createElement('div');
              el.className = 'gps-dot';
              gpsMarker = new maplibregl.Marker({ element: el }).setLngLat([longitude, latitude]).addTo(map);
            } else {
              gpsMarker.setLngLat([longitude, latitude]).addTo(map);
            }
            map.flyTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 14) });
          },
          () => {},
          { enableHighAccuracy: true, timeout: 10000 },
        );
      } else {
        if (gpsMarker) gpsMarker.remove();
      }
    },
  };
}
