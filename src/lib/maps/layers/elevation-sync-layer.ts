// src/lib/maps/layers/elevation-sync-layer.ts
import maplibregl from 'maplibre-gl';
import type { MapLayer, LayerContext } from './types';

export function createElevationSyncLayer(): MapLayer {
  let cursorMarker: maplibregl.Marker | null = null;
  let hoverHandler: ((e: Event) => void) | null = null;
  let leaveHandler: (() => void) | null = null;

  return {
    id: 'elevation-sync',
    hasContent: false,

    setup(ctx: LayerContext) {
      const { map } = ctx;

      hoverHandler = ((e: CustomEvent) => {
        const { lat, lng } = e.detail;
        if (!cursorMarker) {
          const el = document.createElement('div');
          el.className = 'elevation-cursor-dot';
          cursorMarker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
        } else {
          cursorMarker.setLngLat([lng, lat]);
        }
      }) as EventListener;

      leaveHandler = () => {
        if (cursorMarker) { cursorMarker.remove(); cursorMarker = null; }
      };

      window.addEventListener('elevation:hover', hoverHandler);
      window.addEventListener('elevation:leave', leaveHandler);
    },

    teardown(_map: maplibregl.Map) {
      if (hoverHandler) { window.removeEventListener('elevation:hover', hoverHandler); hoverHandler = null; }
      if (leaveHandler) { window.removeEventListener('elevation:leave', leaveHandler); leaveHandler = null; }
      if (cursorMarker) { cursorMarker.remove(); cursorMarker = null; }
    },
  };
}
