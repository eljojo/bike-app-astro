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
import type { Segment } from '../tile-types';

/**
 * Map a click point on a merged tile feature to the logical Segment
 * that contains the closest sub-line.
 *
 * Depends on the contiguous-ordering invariant set up by
 * `scripts/generate-path-tiles.ts::mergeFeatures`: sub-lines of
 * `_segments[i]` must all come before any sub-line of `_segments[i+1]`
 * in the feature's MultiLineString. The walk below uses a running
 * `lineCount` offset to find the owning segment in O(segments) after
 * an O(sub-lines) geometric search.
 *
 * Returns undefined when the feature has no segments or the click
 * can't be resolved to one (defensive — shouldn't happen for tile
 * features built by the current pipeline, but matters for backward-
 * compatible rendering of older tiles).
 */
export function resolveSegmentFromClick(
  feature: { properties?: Record<string, unknown> | null; geometry: { type: string; coordinates: unknown } },
  lngLat: maplibregl.LngLat | { lng: number; lat: number },
): Segment | undefined {
  const props = feature.properties ?? {};
  const rawSegments = (props as Record<string, unknown>)._segments;
  let segments: Segment[] | undefined;
  if (Array.isArray(rawSegments)) {
    segments = rawSegments as Segment[];
  } else if (typeof rawSegments === 'string') {
    // MapLibre sometimes serializes object-valued feature properties to
    // JSON strings when a feature round-trips through a vector tile
    // source. Our tile features are GeoJSON, so this branch is defensive
    // but cheap.
    try {
      const parsed = JSON.parse(rawSegments);
      segments = Array.isArray(parsed) ? (parsed as Segment[]) : undefined;
    } catch {
      segments = undefined;
    }
  }
  if (!segments || segments.length === 0) return undefined;

  const geom = feature.geometry;
  let lines: Array<Array<[number, number]>>;
  if (geom.type === 'LineString') {
    lines = [geom.coordinates as Array<[number, number]>];
  } else if (geom.type === 'MultiLineString') {
    lines = geom.coordinates as Array<Array<[number, number]>>;
  } else {
    return undefined;
  }
  if (lines.length === 0) return undefined;

  const px = (lngLat as { lng: number }).lng;
  const py = (lngLat as { lat: number }).lat;

  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < lines.length; i++) {
    const d = pointToPolylineDistanceSq(px, py, lines[i]);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }

  // Walk segments with running offset until we pass `bestIdx`.
  let running = 0;
  for (const seg of segments) {
    running += seg.lineCount;
    if (bestIdx < running) return seg;
  }
  // Defensive: if lineCount sum < number of lines, fall through to the last segment.
  return segments[segments.length - 1];
}

function pointToPolylineDistanceSq(px: number, py: number, line: Array<[number, number]>): number {
  if (line.length === 0) return Infinity;
  if (line.length === 1) {
    const dx = px - line[0][0];
    const dy = py - line[0][1];
    return dx * dx + dy * dy;
  }
  let min = Infinity;
  for (let i = 1; i < line.length; i++) {
    const d = pointToSegmentDistanceSq(px, py, line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]);
    if (d < min) min = d;
  }
  return min;
}

function pointToSegmentDistanceSq(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  // Planar approximation: fine for finding the minimum over a handful
  // of sub-segments in Ottawa-scale latitudes. Haversine is unnecessary
  // for min-finding; we only use this to pick the closest sub-line, not
  // to report actual distance.
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex = px - ax;
    const ey = py - ay;
    return ex * ex + ey * ey;
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return ex * ex + ey * ey;
}

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

    const feature = features[0];
    const props = feature.properties!;
    if (!foreground && props.hasPage !== 'true') return;
    if (!hasPopupData(props)) return;

    const slug = props.slug as string || '';

    // Delegate to caller when a handler is provided — used by paths-browse-map
    // so map clicks and sidebar clicks run through the same lock/card flow.
    // Segment resolution is deliberately skipped when delegating: the card
    // flow doesn't render per-segment data, so the O(sub-lines) geometric
    // search would be wasted work on every index-page click.
    if (onPathClick && slug) {
      onPathClick(slug);
      return;
    }

    // Resolve the clicked sub-line to its logical Segment so the popup
    // can render Mode B (segment-first, entry as context) when the
    // clicked segment has a distinct name from the parent entry.
    const segment = resolveSegmentFromClick(
      feature as unknown as { properties?: Record<string, unknown>; geometry: { type: string; coordinates: unknown } },
      e.lngLat,
    );

    const info = slugInfo?.[slug];
    if (info) {
      const content = buildPathPopup({
        name: info.name, url: info.url,
        length_km: info.length_km, surface: info.surface,
        path_type: info.path_type, vibe: info.vibe,
        network: info.network, networkUrl: info.networkUrl,
        segment,
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
      segment,
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
