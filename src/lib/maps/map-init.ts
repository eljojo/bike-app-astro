import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import polylineCodec from '@mapbox/polyline';
import type { MapStyleKey } from './map-style-switch';

export const ROUTE_COLOR = '#350091';
export const ROUTE_LINE_WIDTH = 6;
const ROUTE_COLOR_HC = '#0077BB';

/** Palette for multi-ride tour maps. 8 distinct, accessible colors. */
export const TOUR_PALETTE = [
  '#E6194B', // red
  '#3CB44B', // green
  '#4363D8', // blue
  '#F58231', // orange
  '#911EB4', // purple
  '#42D4F4', // cyan
  '#F032E6', // magenta
  '#BFEF45', // lime
];

export function getRouteColor(style?: MapStyleKey): string {
  return style === 'high-contrast' ? ROUTE_COLOR_HC : ROUTE_COLOR;
}

/** Remove a source and all layers referencing it. Needed for style-switch replay. */
export function removeSourceAndLayers(map: maplibregl.Map, sourceId: string) {
  const style = map.getStyle();
  if (style?.layers) {
    for (const layer of style.layers) {
      if ('source' in layer && layer.source === sourceId && map.getLayer(layer.id)) {
        map.removeLayer(layer.id);
      }
    }
  }
  if (map.getSource(sourceId)) {
    map.removeSource(sourceId);
  }
}

/** Single shared popup per map — opening one closes the previous. */
const activePopups = new WeakMap<maplibregl.Map, maplibregl.Popup>();

export function showPopup(map: maplibregl.Map, popup: maplibregl.Popup): void {
  activePopups.get(map)?.remove();
  activePopups.set(map, popup);
  popup.addTo(map);

  // Pan the map so the popup is fully visible
  requestAnimationFrame(() => {
    const el = popup.getElement();
    if (!el) return;
    const mapRect = map.getContainer().getBoundingClientRect();
    const popupRect = el.getBoundingClientRect();
    const pad = 10;
    let dx = 0;
    let dy = 0;
    if (popupRect.left < mapRect.left + pad) dx = popupRect.left - mapRect.left - pad;
    if (popupRect.right > mapRect.right - pad) dx = popupRect.right - mapRect.right + pad;
    if (popupRect.top < mapRect.top + pad) dy = popupRect.top - mapRect.top - pad;
    if (popupRect.bottom > mapRect.bottom - pad) dy = popupRect.bottom - mapRect.bottom + pad;
    if (dx || dy) map.panBy([dx, dy], { animate: true });
  });
}

// --- Interfaces ---

export interface MapOptions {
  el: HTMLElement;
  center: [number, number];
  zoom: number;
  styleUrl: string;
}

export interface PolylineOptions {
  encoded: string;
  popup: string;
  color?: string;
}

export interface MarkerOptions {
  lat: number;
  lng: number;
  emoji: string;
  popup: string;
}

export interface PhotoMarkerOptions {
  key: string;
  lat: number;
  lng: number;
  caption?: string;
  width?: number;
  height?: number;
  routeName?: string;
  routeUrl?: string;
  index: number;
}

export interface WaypointMarkerOptions {
  lat: number;
  lng: number;
  type: string;
  label: string;
  popup?: string;
}

// --- Pure helpers (testable) ---

export function decodeToGeoJson(encoded: string): GeoJSON.Feature<GeoJSON.LineString> {
  const coords = polylineCodec.decode(encoded).map(([lat, lng]) => [lng, lat]);
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: coords },
  };
}

export function buildPolylineFeature(encoded: string, popup: string, color?: string): GeoJSON.Feature<GeoJSON.LineString> {
  const feature = decodeToGeoJson(encoded);
  feature.properties = { popup, ...(color && { color }) };
  return feature;
}

// --- Map initialization ---

export function initMap({ el, center, zoom, styleUrl }: MapOptions): maplibregl.Map {
  return new maplibregl.Map({
    container: el,
    style: styleUrl,
    center: [center[1], center[0]], // MapLibre uses [lng, lat]
    zoom,
    fadeDuration: 0,
    attributionControl: {},
    // Resolve relative URLs to absolute — MapLibre's web worker can't resolve them
    transformRequest: (url) => {
      if (url.startsWith('/')) {
        return { url: `${location.origin}${url}` };
      }
      return { url };
    },
  });
}

// --- Polylines ---

export function addPolylines(
  map: maplibregl.Map,
  polylines: PolylineOptions[],
  styleKey?: MapStyleKey,
): maplibregl.LngLatBounds | null {
  removeSourceAndLayers(map, 'route-polylines');

  const features = polylines.map((p) => buildPolylineFeature(p.encoded, p.popup, p.color));
  const sourceId = 'route-polylines';
  const hasPerPolylineColors = polylines.some(p => p.color);

  map.addSource(sourceId, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features },
  });

  map.addLayer({
    id: 'route-lines',
    type: 'line',
    source: sourceId,
    paint: {
      'line-color': hasPerPolylineColors
        ? ['coalesce', ['get', 'color'], getRouteColor(styleKey)]
        : getRouteColor(styleKey),
      'line-width': ROUTE_LINE_WIDTH,
      'line-opacity': 0.9,
    },
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
  });

  // Click popup on polylines
  map.on('click', 'route-lines', (e) => {
    if (!e.features?.length) return;
    const props = e.features[0].properties;
    if (props?.popup) {
      showPopup(map, new maplibregl.Popup().setLngLat(e.lngLat).setHTML(props.popup));
    }
  });
  map.on('mouseenter', 'route-lines', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'route-lines', () => { map.getCanvas().style.cursor = ''; });

  // Compute bounds
  if (features.length === 0) return null;
  const bounds = new maplibregl.LngLatBounds();
  for (const f of features) {
    for (const coord of f.geometry.coordinates) {
      bounds.extend(coord as [number, number]);
    }
  }
  return bounds;
}

// --- Emoji markers (places, clustered) ---

const placeBubbleSyncHandlers = new WeakMap<maplibregl.Map, () => void>();

export function addMarkers(map: maplibregl.Map, markers: MarkerOptions[]): void {
  removeSourceAndLayers(map, 'place-markers');
  map.getContainer().querySelectorAll('.poi-marker').forEach(el => el.remove());

  const previousSync = placeBubbleSyncHandlers.get(map);
  if (previousSync) {
    map.off('idle', previousSync);
    placeBubbleSyncHandlers.delete(map);
  }

  const sourceId = 'place-markers';

  map.addSource(sourceId, {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: markers.map((m) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [m.lng, m.lat] },
        properties: { emoji: m.emoji, popup: m.popup },
      })),
    },
    cluster: true,
    clusterRadius: 50,
    clusterMaxZoom: 14,
  });

  // Cluster circles
  map.addLayer({
    id: 'place-clusters',
    type: 'circle',
    source: sourceId,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#ffffff',
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 12, 15, 18],
      'circle-stroke-color': '#cccccc',
      'circle-stroke-width': 2,
    },
  });

  // Cluster count labels
  map.addLayer({
    id: 'place-cluster-count',
    type: 'symbol',
    source: sourceId,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': '{point_count_abbreviated}',
      'text-font': ['NotoSans_Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 15, 13],
    },
    paint: { 'text-color': '#555555' },
  });

  // Invisible layer for unclustered feature detection
  map.addLayer({
    id: 'place-unclustered',
    type: 'circle',
    source: sourceId,
    filter: ['!', ['has', 'point_count']],
    paint: { 'circle-radius': 1, 'circle-opacity': 0 },
  });

  // --- DOM emoji markers for unclustered places ---
  const emojiMarkers = new Map<string, maplibregl.Marker>();

  function syncPlaceMarkers() {
    const features = map.queryRenderedFeatures({ layers: ['place-unclustered'] });
    const seen = new Set<string>();

    for (const f of features) {
      const props = f.properties!;
      const key = `${(f.geometry as GeoJSON.Point).coordinates.join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (!emojiMarkers.has(key)) {
        const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
        const el = document.createElement('div');
        el.className = 'poi-marker';
        el.style.cursor = 'pointer';
        el.innerHTML = `<span class="poi-marker-emoji">${props.emoji}</span>`;

        const popupHtml = props.popup;
        const popup = new maplibregl.Popup({ offset: 20, maxWidth: '320px' }).setHTML(popupHtml);

        el.addEventListener('click', (e) => {
          e.stopPropagation();
          popup.setLngLat(coords);
          showPopup(map, popup);
        });

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat(coords)
          .addTo(map);

        emojiMarkers.set(key, marker);
      }
    }

    for (const [key, marker] of emojiMarkers) {
      if (!seen.has(key)) {
        marker.remove();
        emojiMarkers.delete(key);
      }
    }
  }

  map.on('idle', syncPlaceMarkers);
  placeBubbleSyncHandlers.set(map, syncPlaceMarkers);

  // Click to zoom into cluster
  map.on('click', 'place-clusters', async (e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: ['place-clusters'] });
    if (!features.length) return;
    const clusterId = features[0].properties?.cluster_id;
    const source = map.getSource(sourceId) as maplibregl.GeoJSONSource;
    const zoom = await source.getClusterExpansionZoom(clusterId);
    map.easeTo({ center: (features[0].geometry as GeoJSON.Point).coordinates as [number, number], zoom });
  });

  map.on('mouseenter', 'place-clusters', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'place-clusters', () => { map.getCanvas().style.cursor = ''; });
}

// --- Photo popup utility ---

export function photoPopupMaxWidth(zoom: number): number {
  // Exponential scaling: grows fast when zoomed in, tiny when zoomed out
  const t = Math.max(0, Math.min(1, (zoom - 8) / 8)); // 0 at z8, 1 at z16
  return Math.round(100 + 400 * t * t);
}
