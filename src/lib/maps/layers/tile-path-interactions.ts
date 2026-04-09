// src/lib/maps/layers/tile-path-interactions.ts
//
// Click popup and hover cursor handlers for the bike path tile overlay.

import maplibregl from 'maplibre-gl';
import { showPopup } from '../map-init';
import { buildPathPopup } from '../map-helpers';
import { LINE_LAYERS, CLICKABLE_LAYERS } from './tile-path-styles';

export interface PathInteractionOptions {
  foreground: boolean;
  slugInfo?: Record<string, { name: string; url: string; length_km?: number; surface?: string; path_type?: string; vibe?: string; network?: string; networkUrl?: string }>;
  labels?: { viewDetails?: string };
}

// TODO: some features (e.g. Ottawa River Pathway) open an empty popup —
// likely a geo-metadata mapping gap where the tile feature has no name/slug.
// Investigate which geoIds are missing metadata in generate-geo-metadata.ts.
function hasPopupData(props: Record<string, unknown>): boolean {
  return !!(props.name);
}

/**
 * Wire click and hover handlers for path features.
 * Returns a cleanup function that removes all event listeners.
 */
export function setupPathInteractions(
  map: maplibregl.Map,
  opts: PathInteractionOptions,
): () => void {
  const { foreground, slugInfo, labels } = opts;

  const clickHandler = (e: maplibregl.MapLayerMouseEvent) => {
    if (!e.features?.length) return;
    const props = e.features[0].properties!;
    if (!foreground && props.hasPage !== 'true') return;
    if (!hasPopupData(props)) return;

    const slug = props.slug as string || '';
    const info = slugInfo?.[slug];
    if (info) {
      const content = buildPathPopup({
        name: info.name, url: info.url,
        length_km: info.length_km, surface: info.surface,
        path_type: info.path_type, vibe: info.vibe,
        network: info.network, networkUrl: info.networkUrl,
      }, labels);
      showPopup(map, new maplibregl.Popup({ closeButton: true, maxWidth: '280px' })
        .setLngLat(e.lngLat).setHTML(content));
      return;
    }

    // Fallback: build popup from tile properties
    const name = props.name || '';
    const memberOf = props.memberOf || '';
    let pathUrl = '';
    if (slug && (props.hasPage === true || props.hasPage === 'true')) {
      pathUrl = memberOf ? `/bike-paths/${memberOf}/${slug}` : `/bike-paths/${slug}`;
    } else if (memberOf) {
      pathUrl = `/bike-paths/${memberOf}`;
    }
    const content = buildPathPopup({
      name,
      url: pathUrl || undefined,
      length_km: props.length_km || undefined,
      surface: props.surface || undefined,
      path_type: props.path_type || undefined,
    }, labels);

    showPopup(map, new maplibregl.Popup({ closeButton: true, maxWidth: '280px' })
      .setLngLat(e.lngLat).setHTML(content));
  };

  const enterHandler = (e: maplibregl.MapLayerMouseEvent) => {
    if (!e.features?.length) return;
    const props = e.features[0].properties!;
    const slug = props.slug as string;
    if ((slug && slugInfo?.[slug]) || hasPopupData(props)) {
      map.getCanvas().style.cursor = 'pointer';
    }
  };

  const leaveHandler = () => { map.getCanvas().style.cursor = ''; };

  // In foreground mode, attach to all layers (including bg); otherwise line layers only
  const layers = foreground ? CLICKABLE_LAYERS : LINE_LAYERS;
  for (const id of layers) {
    if (map.getLayer(id)) {
      map.on('click', id, clickHandler);
      map.on('mouseenter', id, enterHandler);
      map.on('mouseleave', id, leaveHandler);
    }
  }

  // Cleanup: remove from all possible layers (safe — off() for unattached is a no-op)
  return () => {
    const all = new Set([...LINE_LAYERS, ...CLICKABLE_LAYERS]);
    for (const id of all) {
      if (map.getLayer(id)) {
        map.off('click', id, clickHandler);
        map.off('mouseenter', id, enterHandler);
        map.off('mouseleave', id, leaveHandler);
      }
    }
  };
}
