import { MAP_STYLE_URL, MAP_STYLE_HC_URL } from './map-style-url';

export type MapStyleKey = 'default' | 'high-contrast';

const STORAGE_KEY = 'map-style';

export function getStyleUrl(key: MapStyleKey): string {
  return key === 'high-contrast' ? MAP_STYLE_HC_URL : MAP_STYLE_URL;
}

export function loadStylePreference(): MapStyleKey {
  if (typeof localStorage === 'undefined') return 'default';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'high-contrast') return 'high-contrast';
  return 'default';
}

export function saveStylePreference(key: MapStyleKey): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, key);
}

/**
 * Switch the map's base style and replay the setup callback.
 *
 * MapLibre's setStyle() strips all custom sources and layers (route
 * polylines, photo markers). The replaySetup callback re-adds them
 * after the new style loads.
 *
 * DOM-based markers (emoji places, photo bubbles) survive the switch
 * since they live in the DOM, not WebGL.
 */
export function switchStyle(
  map: import('maplibre-gl').Map,
  key: MapStyleKey,
  replaySetup: () => void,
): void {
  const url = getStyleUrl(key);
  map.setStyle(url);
  map.once('style.load', replaySetup);
}
