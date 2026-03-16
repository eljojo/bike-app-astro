import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import polylineCodec from '@mapbox/polyline';
import { html, raw } from './map-helpers';
import { buildImageUrl } from '../media/image-service';
import type { MapStyleKey } from './map-style-switch';

export const ROUTE_COLOR = '#350091';
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
function removeSourceAndLayers(map: maplibregl.Map, sourceId: string) {
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

/** Track the syncPhotoBubbles handler per map so it can be removed on replay. */
const photoBubbleSyncHandlers = new WeakMap<maplibregl.Map, () => void>();

/** Single shared popup per map — opening one closes the previous. */
const activePopups = new WeakMap<maplibregl.Map, maplibregl.Popup>();

function showPopup(map: maplibregl.Map, popup: maplibregl.Popup): void {
  activePopups.get(map)?.remove();
  activePopups.set(map, popup);
  popup.addTo(map);
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
      'line-width': 6,
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
const PLACE_LAYER_IDS = ['place-clusters', 'place-cluster-count', 'place-unclustered'];

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
          activePopups.get(map)?.remove();
          activePopups.set(map, popup);
          popup.setLngLat(coords).addTo(map);
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

// --- Photo markers (clustered with thumbnail bubbles) ---

const preloadedUrls = new Set<string>();
const photosVisible = new WeakMap<maplibregl.Map, boolean>();

function preloadImage(url: string): void {
  if (preloadedUrls.has(url)) return;
  preloadedUrls.add(url);
  const img = new Image();
  img.src = url;
}

export function photoPopupMaxWidth(zoom: number): number {
  // Exponential scaling: grows fast when zoomed in, tiny when zoomed out
  const t = Math.max(0, Math.min(1, (zoom - 8) / 8)); // 0 at z8, 1 at z16
  return Math.round(100 + 400 * t * t);
}

interface PhotoPopupProps {
  key: string;
  routeName?: string;
  routeUrl?: string;
  caption?: string;
  width?: number;
  height?: number;
}

function showPhotoPopup(
  map: maplibregl.Map,
  props: PhotoPopupProps,
  coords: [number, number],
  cdnUrl: string,
): void {
  const imgUrl = buildImageUrl(cdnUrl, props.key, { width: 800, fit: 'scale-down' });
  const fullUrl = buildImageUrl(cdnUrl, props.key, { width: 1600 });

  const routeLink = props.routeName && props.routeUrl
    ? html`<p class="photo-popup-route"><a href="${raw(props.routeUrl)}">${props.routeName}</a></p>` : '';
  const captionBlock = props.caption ? html`<p class="photo-popup-caption">${props.caption}</p>` : '';

  // Use fixed 800px width for the image transform; derive display height from aspect ratio
  const imgWidth = 800;
  const imgHeight = props.width && props.height ? Math.round(imgWidth * props.height / props.width) : undefined;
  const sizeAttrs = imgHeight ? ` width="${imgWidth}" height="${imgHeight}"` : '';

  const popupHtml = html`
    <div class="photo-popup-content">
      <a href="${raw(fullUrl)}" target="_blank">
        <img src="${raw(imgUrl)}" alt="${props.caption || 'Photo'}"${raw(sizeAttrs)} />
      </a>
      ${raw(captionBlock)}
      ${raw(routeLink)}
    </div>
  `;

  const popup = new maplibregl.Popup({ maxWidth: `${photoPopupMaxWidth(map.getZoom())}px` })
    .setLngLat(coords)
    .setHTML(popupHtml);
  showPopup(map, popup);

  const onZoom = () => {
    popup.setMaxWidth(`${photoPopupMaxWidth(map.getZoom())}px`);
  };
  map.on('zoom', onZoom);
  popup.on('close', () => map.off('zoom', onZoom));
}

export function addPhotoMarkers(
  map: maplibregl.Map,
  photos: PhotoMarkerOptions[],
  cdnUrl: string,
  styleKey?: MapStyleKey,
): void {
  // Clean up previous photo markers (idempotent for style-switch replay)
  removeSourceAndLayers(map, 'photo-markers');
  map.getContainer().querySelectorAll('.photo-bubble').forEach(el => el.remove());

  const previousSync = photoBubbleSyncHandlers.get(map);
  if (previousSync) {
    map.off('idle', previousSync);
    photoBubbleSyncHandlers.delete(map);
  }

  const sourceId = 'photo-markers';

  map.addSource(sourceId, {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: photos.map((p) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
        properties: {
          key: p.key, caption: p.caption || '', index: p.index,
          routeName: p.routeName || '', routeUrl: p.routeUrl || '',
          width: p.width || 0, height: p.height || 0,
        },
      })),
    },
    cluster: true,
    clusterRadius: 80,
    clusterMaxZoom: 15,
  });

  // Dynamic minzoom: many photos (city map) require zooming in, few photos (route/tour) show immediately
  const minZoom = photos.length > 200 ? 11 : photos.length > 50 ? 8 : 0;

  // Invisible cluster layer for queryRenderedFeatures detection
  map.addLayer({
    id: 'photo-clusters',
    type: 'circle',
    source: sourceId,
    filter: ['has', 'point_count'],
    minzoom: minZoom,
    paint: { 'circle-radius': 1, 'circle-opacity': 0 },
  });

  // Invisible layer for unclustered feature detection
  map.addLayer({
    id: 'photo-unclustered',
    type: 'circle',
    source: sourceId,
    filter: ['!', ['has', 'point_count']],
    minzoom: minZoom,
    paint: { 'circle-radius': 1, 'circle-opacity': 0 },
  });

  // --- DOM markers for both clusters (thumbnail + count badge) and individual photos ---
  const bubbleMarkers = new Map<string, maplibregl.Marker>();
  const clusterMarkers = new Map<number, maplibregl.Marker>();

  async function syncPhotoBubbles() {
    const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    // --- Unclustered individual photos ---
    const unclustered = map.queryRenderedFeatures({ layers: ['photo-unclustered'] });
    const seenKeys = new Set<string>();

    for (const f of unclustered) {
      const key = f.properties!.key as string;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      if (!bubbleMarkers.has(key)) {
        const props = f.properties!;
        const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
        const thumbUrl = buildImageUrl(cdnUrl, props.key, { width: 80, height: 80, fit: 'cover' });

        const el = document.createElement('div');
        el.className = 'photo-bubble';
        el.innerHTML = `<img src="${thumbUrl}" alt="" loading="lazy" />`;

        el.addEventListener('mouseenter', () => {
          if (photosVisible.get(map) === false) return;
          preloadImage(buildImageUrl(cdnUrl, props.key, { width: 1000, fit: 'scale-down' }));
        });

        el.addEventListener('click', (e) => {
          e.stopPropagation();
          showPhotoPopup(map, props as unknown as PhotoPopupProps, coords, cdnUrl);
        });

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat(coords)
          .addTo(map);

        bubbleMarkers.set(key, marker);
      }
    }

    // Scale bubble size with zoom
    const bubbleSize = Math.round(Math.min(48, Math.max(30, (map.getZoom() - 11) * 4.5 + 30)));
    for (const [, marker] of bubbleMarkers) {
      const el = marker.getElement().querySelector('.photo-bubble') || marker.getElement();
      (el as HTMLElement).style.width = `${bubbleSize}px`;
      (el as HTMLElement).style.height = `${bubbleSize}px`;
    }

    // Preload popup images for visible photos
    if (photosVisible.get(map) !== false) {
      for (const key of seenKeys) {
        preloadImage(buildImageUrl(cdnUrl, key, { width: 1000, fit: 'scale-down' }));
      }
    }

    // Remove individual markers no longer visible
    for (const [key, marker] of bubbleMarkers) {
      if (!seenKeys.has(key)) {
        marker.remove();
        bubbleMarkers.delete(key);
      }
    }

    // --- Clustered photo thumbnails with count badge ---
    const clusters = map.queryRenderedFeatures({ layers: ['photo-clusters'] });
    const seenClusterIds = new Set<number>();

    for (const f of clusters) {
      const clusterId = f.properties?.cluster_id as number;
      if (seenClusterIds.has(clusterId)) continue;
      seenClusterIds.add(clusterId);

      if (!clusterMarkers.has(clusterId)) {
        const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
        const count = f.properties?.point_count as number;

        // Get the first leaf to use as the cluster thumbnail
        try {
          const leaves = await source.getClusterLeaves(clusterId, 1, 0);
          const leafKey = leaves[0]?.properties?.key as string | undefined;
          if (!leafKey) continue;

          const thumbUrl = buildImageUrl(cdnUrl, leafKey, { width: 80, height: 80, fit: 'cover' });

          const el = document.createElement('div');
          el.className = 'photo-bubble photo-bubble--cluster';
          el.innerHTML = `<img src="${thumbUrl}" alt="" loading="lazy" /><span class="photo-bubble--count">${count}</span>`;

          el.addEventListener('click', async (e) => {
            e.stopPropagation();
            const zoom = await source.getClusterExpansionZoom(clusterId);
            map.easeTo({ center: coords, zoom });
          });

          const marker = new maplibregl.Marker({ element: el })
            .setLngLat(coords)
            .addTo(map);

          clusterMarkers.set(clusterId, marker);
        } catch {
          // Cluster may have been removed between query and leaf fetch
        }
      }
    }

    // Scale cluster markers with zoom
    const clusterSize = Math.round(Math.min(52, Math.max(34, (map.getZoom() - 8) * 3 + 34)));
    for (const [, marker] of clusterMarkers) {
      const el = marker.getElement().querySelector('.photo-bubble') || marker.getElement();
      (el as HTMLElement).style.width = `${clusterSize}px`;
      (el as HTMLElement).style.height = `${clusterSize}px`;
    }

    // Remove cluster markers no longer visible
    for (const [id, marker] of clusterMarkers) {
      if (!seenClusterIds.has(id)) {
        marker.remove();
        clusterMarkers.delete(id);
      }
    }
  }

  map.on('idle', syncPhotoBubbles);
  photoBubbleSyncHandlers.set(map, syncPhotoBubbles);
}

// --- Waypoint markers (checkpoints, danger, POI) ---

export interface WaypointMarkerOptions {
  lat: number;
  lng: number;
  type: string;
  label: string;
  popup?: string;
}

const waypointDomMarkers = new WeakMap<maplibregl.Map, maplibregl.Marker[]>();

export function addWaypointMarkers(
  map: maplibregl.Map,
  waypoints: WaypointMarkerOptions[],
): void {
  // Remove previous waypoint markers
  const prev = waypointDomMarkers.get(map);
  if (prev) {
    for (const m of prev) m.remove();
  }

  const markers: maplibregl.Marker[] = [];
  waypoints.forEach(wp => {
    const el = document.createElement('div');
    el.className = `waypoint-marker waypoint-marker--${wp.type}`;

    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([wp.lng, wp.lat])
      .addTo(map);

    if (wp.popup) {
      marker.setPopup(new maplibregl.Popup({ offset: 14, maxWidth: '300px' }).setHTML(wp.popup));
    } else {
      el.title = wp.label;
    }

    markers.push(marker);
  });
  waypointDomMarkers.set(map, markers);
}

// --- GPS location ---

let gpsMarker: maplibregl.Marker | null = null;

export function showUserLocation(map: maplibregl.Map): void {
  if (!('geolocation' in navigator)) return;

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { longitude, latitude } = pos.coords;

      if (!gpsMarker) {
        const el = document.createElement('div');
        el.className = 'gps-dot';
        gpsMarker = new maplibregl.Marker({ element: el })
          .setLngLat([longitude, latitude])
          .addTo(map);
      } else {
        gpsMarker.setLngLat([longitude, latitude]);
        gpsMarker.addTo(map);
      }

      map.flyTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 14) });
    },
    () => {}, // silently ignore denied/unavailable
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

export function hideUserLocation(): void {
  if (gpsMarker) {
    gpsMarker.remove();
  }
}

// --- Layer visibility helpers ---

const PHOTO_LAYER_IDS = ['photo-clusters', 'photo-cluster-count', 'photo-unclustered'];

export function setPhotoLayersVisible(map: maplibregl.Map, visible: boolean): void {
  photosVisible.set(map, visible);
  const vis = visible ? 'visible' : 'none';
  for (const id of PHOTO_LAYER_IDS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
  }
  // Also toggle DOM photo bubble markers
  const bubbles = map.getContainer().querySelectorAll('.photo-bubble');
  for (const el of bubbles) {
    (el as HTMLElement).style.display = visible ? '' : 'none';
  }
}

export function setPlaceMarkersVisible(map: maplibregl.Map, visible: boolean): void {
  const vis = visible ? 'visible' : 'none';
  for (const id of PLACE_LAYER_IDS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
  }
  const markers = map.getContainer().querySelectorAll('.poi-marker');
  for (const el of markers) {
    (el as HTMLElement).style.display = visible ? '' : 'none';
  }
}

// --- Elevation cursor sync ---

/** Add a cursor dot that follows elevation:hover events on the map. */
export function enableElevationCursorSync(map: maplibregl.Map): void {
  let cursorMarker: maplibregl.Marker | null = null;

  window.addEventListener('elevation:hover', ((e: CustomEvent) => {
    const { lat, lng } = e.detail;
    if (!cursorMarker) {
      const el = document.createElement('div');
      el.className = 'elevation-cursor-dot';
      cursorMarker = new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(map);
    } else {
      cursorMarker.setLngLat([lng, lat]);
    }
  }) as EventListener);

  window.addEventListener('elevation:leave', () => {
    if (cursorMarker) {
      cursorMarker.remove();
      cursorMarker = null;
    }
  });
}
