// src/lib/maps/layers/map-session.ts
import { initMap } from '../map-init';
import { loadStylePreference, getStyleUrl, switchStyle } from '../map-style-switch';
import type { MapStyleKey } from '../map-style-switch';
import type { MapLayer, MapSession, LayerContext } from './types';
import maplibregl from 'maplibre-gl';

export interface MapSessionOptions {
  el: HTMLElement;
  center: [number, number];
  zoom: number;
  /** If false, skip auto-fitting bounds after layer setup. Default: true. */
  fitBounds?: boolean;
}

export function createMapSession(opts: MapSessionOptions): MapSession & {
  /** Switch map style and replay all layer setups. Pass to MapControls onToggleStyle. */
  switchStyle(key: MapStyleKey, afterReplay?: () => void): void;
  /** Access registered layers array (for wiring controls). */
  layers: readonly MapLayer[];
} {
  const initialStyleKey = loadStylePreference();
  const map = initMap({
    el: opts.el,
    center: opts.center,
    zoom: opts.zoom,
    styleUrl: getStyleUrl(initialStyleKey),
  });

  const layers: MapLayer[] = [];
  let generation = 0;

  function makeContext(styleKey: MapStyleKey): LayerContext {
    const gen = generation;
    return {
      map,
      styleKey,
      generation: gen,
      isCurrent: () => gen === generation,
    };
  }

  async function setupAll(styleKey: MapStyleKey) {
    const ctx = makeContext(styleKey);
    for (const layer of layers) {
      layer.teardown(map);
    }
    for (const layer of layers) {
      await layer.setup(ctx);
      if (!ctx.isCurrent()) return;
    }
  }

  function fitAllBounds() {
    const combined = new maplibregl.LngLatBounds();
    let hasBounds = false;
    for (const layer of layers) {
      const b = layer.getBounds?.();
      if (b && !b.isEmpty()) {
        combined.extend(b);
        hasBounds = true;
      }
    }
    if (hasBounds) {
      map.fitBounds(combined.toArray() as [[number, number], [number, number]], { padding: 30 });
    }
  }

  return {
    map,
    layers,

    use(layer: MapLayer) {
      layers.push(layer);
      return this;
    },

    getLayer(id: string) {
      return layers.find(l => l.id === id);
    },

    start(onReady?: () => void) {
      map.on('load', async () => {
        await setupAll(initialStyleKey);
        if (opts.fitBounds !== false) fitAllBounds();
        onReady?.();
      });
    },

    switchStyle(key: MapStyleKey, afterReplay?: () => void) {
      generation++;
      switchStyle(map, key, async () => {
        await setupAll(key);
        afterReplay?.();
      });
    },
  };
}
