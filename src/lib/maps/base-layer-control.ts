/**
 * Runtime control over base map (tile-baked) cycling layers.
 *
 * When bike paths are the foreground, the base map's oasis/exposed layers
 * compete — same infrastructure drawn twice in different colors. This module
 * lets us mute or restore those layers at runtime via setPaintProperty.
 */
import type maplibregl from 'maplibre-gl';

/** Base map layer IDs for cycling infrastructure (from build-map-style.ts) */
const OASIS_LAYERS = [
  'oasis-cycleway-casing',
  'oasis-cycleway',
  'oasis-path',
  'cycling-route-lowzoom-casing',
  'cycling-route-lowzoom',
  'cycling-route-casing',
  'cycling-route',
  'mtb-route-casing',
  'mtb-route',
  'label-cycleway',
  'label-cycling-node',
] as const;

const EXPOSED_LAYERS = [
  'road-cycleway-overlay',
] as const;

const ALL_CYCLING_LAYERS = [...OASIS_LAYERS, ...EXPOSED_LAYERS] as const;

/**
 * Set the base map's cycling infrastructure layers to a specific opacity.
 * 0 = invisible, 1 = fully restored to style-spec defaults.
 */
export function setBaseCyclingOpacity(map: maplibregl.Map, opacity: number): void {
  for (const id of ALL_CYCLING_LAYERS) {
    if (!map.getLayer(id)) continue;

    const layer = map.getLayer(id)!;
    const type = layer.type;

    if (type === 'line') {
      map.setPaintProperty(id, 'line-opacity', opacity === 1 ? null : opacity);
    } else if (type === 'symbol') {
      map.setPaintProperty(id, 'text-opacity', opacity === 1 ? null : opacity * 0.8);
    }
  }
}

/**
 * Mute the base map's cycling infrastructure layers.
 * Keeps them present as orientation context (teal at 0.3) but subordinate
 * to the foreground path overlay.
 */
export function muteBaseCyclingLayers(map: maplibregl.Map): void {
  setBaseCyclingOpacity(map, 0.3);
}

/**
 * Restore the base map's cycling infrastructure layers to their normal state.
 * Called when switching back to routes foreground.
 */
export function restoreBaseCyclingLayers(map: maplibregl.Map): void {
  for (const id of ALL_CYCLING_LAYERS) {
    if (!map.getLayer(id)) continue;

    const layer = map.getLayer(id)!;
    const type = layer.type;

    if (type === 'line') {
      // Restore to the original opacity values from build-map-style.ts
      // Most oasis layers are 0.7-0.8, exposed is 0.7, casings are 1.0
      // Using null removes the override and restores the style-spec default
      map.setPaintProperty(id, 'line-opacity', null);
    } else if (type === 'symbol') {
      map.setPaintProperty(id, 'text-opacity', null);
    }
  }
}
