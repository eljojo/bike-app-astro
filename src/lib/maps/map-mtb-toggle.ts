/**
 * MTB trail visibility toggle for the bike paths browse map.
 *
 * Adds a button that hides/shows MTB trail features (path_type=mtb-trail).
 * Default: visible. Toggling off filters out MTB features from all path layers.
 */

import type maplibregl from 'maplibre-gl';
import { ALL_LAYER_IDS } from './layers/tile-path-styles';

export function createMtbToggle(
  map: maplibregl.Map,
  container: HTMLElement,
) {
  let mtbVisible = true;

  const btn = document.createElement('button');
  btn.className = 'map-mtb-toggle active';
  btn.setAttribute('aria-label', 'Toggle MTB trails');
  btn.title = 'Toggle MTB trails';
  btn.textContent = 'MTB';
  container.appendChild(btn);

  // Store original filters per layer so we can restore them
  const originalFilters = new Map<string, unknown>();

  map.on('load', () => {
    for (const id of ALL_LAYER_IDS) {
      if (map.getLayer(id)) {
        originalFilters.set(id, map.getFilter(id));
      }
    }
  });

  function applyFilter() {
    for (const id of ALL_LAYER_IDS) {
      if (!map.getLayer(id)) continue;
      const original = originalFilters.get(id);
      if (mtbVisible) {
        // Restore original filter
        map.setFilter(id, (original ?? null) as maplibregl.FilterSpecification | null);
      } else {
        // Wrap original filter with MTB exclusion
        const exclude = ['!=', ['get', 'path_type'], 'mtb-trail'];
        if (original) {
          map.setFilter(id, ['all', original, exclude] as unknown as maplibregl.FilterSpecification);
        } else {
          map.setFilter(id, exclude as unknown as maplibregl.FilterSpecification);
        }
      }
    }
    btn.classList.toggle('active', mtbVisible);
  }

  btn.addEventListener('click', () => {
    mtbVisible = !mtbVisible;
    applyFilter();
  });

  return { toggle: () => { mtbVisible = !mtbVisible; applyFilter(); } };
}
