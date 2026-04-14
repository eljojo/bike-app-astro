/**
 * MTB trail visibility toggle for tile path layers.
 *
 * Returns a toggle function that hides/shows MTB trail features
 * (path_type=mtb-trail) by filtering all path tile layers.
 * Captures original filters lazily — layers may not exist at creation time.
 */

import type maplibregl from 'maplibre-gl';
import { ALL_LAYER_IDS } from './layers/tile-path-styles';
import { IS_TRAIL_EXPR } from './map-swatch';

export function createMtbFilter(map: maplibregl.Map) {
  let mtbVisible = true;
  const originalFilters = new Map<string, unknown>();

  function setVisible(visible: boolean) {
    mtbVisible = visible;
    for (const id of ALL_LAYER_IDS) {
      if (!map.getLayer(id)) continue;
      // Lazy capture: first time we touch a layer, save its original filter
      if (!originalFilters.has(id)) {
        originalFilters.set(id, map.getFilter(id));
      }
      if (visible) {
        const original = originalFilters.get(id);
        map.setFilter(id, (original ?? null) as maplibregl.FilterSpecification | null);
      } else {
        const original = originalFilters.get(id);
        const exclude = ['!', IS_TRAIL_EXPR];
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
