/**
 * MTB trail visibility toggle for tile path layers.
 *
 * Returns a toggle function that hides/shows MTB trail features
 * (path_type=mtb-trail) by filtering all path tile layers.
 * Designed to be called from MapControls or any UI toggle.
 */

import type maplibregl from 'maplibre-gl';
import { ALL_LAYER_IDS } from './layers/tile-path-styles';

export function createMtbFilter(map: maplibregl.Map) {
  let mtbVisible = true;
  const originalFilters = new Map<string, unknown>();

  // Capture original filters once layers exist
  function captureFilters() {
    for (const id of ALL_LAYER_IDS) {
      if (map.getLayer(id) && !originalFilters.has(id)) {
        originalFilters.set(id, map.getFilter(id));
      }
    }
  }

  map.on('load', captureFilters);
  // Also capture after style switch (layers get recreated)
  map.on('styledata', captureFilters);

  function setVisible(visible: boolean) {
    mtbVisible = visible;
    for (const id of ALL_LAYER_IDS) {
      if (!map.getLayer(id)) continue;
      const original = originalFilters.get(id);
      if (visible) {
        map.setFilter(id, (original ?? null) as maplibregl.FilterSpecification | null);
      } else {
        const exclude = ['!=', ['get', 'path_type'], 'mtb-trail'];
        if (original) {
          map.setFilter(id, ['all', original, exclude] as unknown as maplibregl.FilterSpecification);
        } else {
          map.setFilter(id, exclude as unknown as maplibregl.FilterSpecification);
        }
      }
    }
  }

  return {
    toggle: () => setVisible(!mtbVisible),
    setVisible,
    isVisible: () => mtbVisible,
  };
}
