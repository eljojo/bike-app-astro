// src/lib/maps/layers/tile-path-interactions.ts
//
// Click popup and hover cursor handlers for the bike path tile overlay.
//
// Clicks use a padded bbox hit test instead of MapLibre's strict per-layer
// click binding — bike path lines are thin, so a strict pixel hit test
// feels unreliable and misses taps on mobile. The global click handler
// queries a small pixel box around the click point; any path within the
// box counts as a hit. Touch devices get more padding than desktop.

import maplibregl from 'maplibre-gl';
import { showPopup } from '../map-init';
import { buildPathPopup } from '../map-helpers';
import { LINE_LAYERS, CLICKABLE_LAYERS } from './tile-path-styles';

export interface PathInteractionOptions {
  foreground: boolean;
  slugInfo?: Record<string, { name: string; url: string; length_km?: number; surface?: string; path_type?: string; vibe?: string; network?: string; networkUrl?: string }>;
  labels?: { viewDetails?: string };
  /** If provided, clicks on path features invoke this callback with the slug
   *  instead of opening a MapLibre popup. */
  onPathClick?: (slug: string) => void;
}

// TODO: some features (e.g. Ottawa River Pathway) open an empty popup —
// likely a geo-metadata mapping gap where the tile feature has no name/slug.
// Investigate which geoIds are missing metadata in generate-geo-metadata.ts.
function hasPopupData(props: Record<string, unknown>): boolean {
  return !!(props.name);
}

/** Half-width (pixels) of the click-hit box around the tap/click point.
 *  Touch devices use a larger pad because finger taps are less precise. */
const CLICK_PAD_DESKTOP = 8;
const CLICK_PAD_TOUCH = 14;

function clickPadding(): number {
  if (typeof window === 'undefined') return CLICK_PAD_DESKTOP;
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches
    ? CLICK_PAD_TOUCH
    : CLICK_PAD_DESKTOP;
}

/**
 * Wire click and hover handlers for path features.
 * Returns a cleanup function that removes all event listeners.
 */
export function setupPathInteractions(
  map: maplibregl.Map,
  opts: PathInteractionOptions,
): () => void {
  const { foreground, slugInfo, labels, onPathClick } = opts;

  const pad = clickPadding();
  const layers = foreground ? CLICKABLE_LAYERS : LINE_LAYERS;

  const clickHandler = (e: maplibregl.MapMouseEvent) => {
    // Padded bbox around the click point — any path within `pad` pixels
    // counts as a hit. Larger pad on touch devices.
    const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
      [e.point.x - pad, e.point.y - pad],
      [e.point.x + pad, e.point.y + pad],
    ];
    const availableLayers = layers.filter(id => map.getLayer(id));
    if (availableLayers.length === 0) return;

    const features = map.queryRenderedFeatures(bbox, { layers: availableLayers });
    if (features.length === 0) return;

    const props = features[0].properties!;
    if (!foreground && props.hasPage !== 'true') return;
    if (!hasPopupData(props)) return;

    const slug = props.slug as string || '';

    // Delegate to caller when a handler is provided — used by paths-browse-map
    // so map clicks and sidebar clicks run through the same lock/card flow.
    if (onPathClick && slug) {
      onPathClick(slug);
      return;
    }

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
    const lengthKm = props.length_km ? Number(props.length_km) : undefined;
    const content = buildPathPopup({
      name,
      url: pathUrl || undefined,
      length_km: lengthKm || undefined,
      surface: props.surface || undefined,
      path_type: props.path_type || undefined,
    }, labels);

    showPopup(map, new maplibregl.Popup({ closeButton: true, maxWidth: '280px' })
      .setLngLat(e.lngLat).setHTML(content));
  };

  // Hover cursor: strict per-layer binding is fine here — it's a cosmetic
  // cue, not a click target. Less invasive than a global mousemove listener.
  const enterHandler = (e: maplibregl.MapLayerMouseEvent) => {
    if (!e.features?.length) return;
    const props = e.features[0].properties!;
    const slug = props.slug as string;
    if ((slug && slugInfo?.[slug]) || hasPopupData(props)) {
      map.getCanvas().style.cursor = 'pointer';
    }
  };

  const leaveHandler = () => { map.getCanvas().style.cursor = ''; };

  // Global click handler — one listener across all path layers so the bbox
  // query can span them. Hover still attaches per-layer for cursor change.
  map.on('click', clickHandler);
  for (const id of layers) {
    if (map.getLayer(id)) {
      map.on('mouseenter', id, enterHandler);
      map.on('mouseleave', id, leaveHandler);
    }
  }

  // Cleanup: remove from all possible layers (safe — off() for unattached is a no-op)
  return () => {
    map.off('click', clickHandler);
    const all = new Set([...LINE_LAYERS, ...CLICKABLE_LAYERS]);
    for (const id of all) {
      if (map.getLayer(id)) {
        map.off('mouseenter', id, enterHandler);
        map.off('mouseleave', id, leaveHandler);
      }
    }
  };
}
