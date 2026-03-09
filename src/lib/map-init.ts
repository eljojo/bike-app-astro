import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import polylineCodec from '@mapbox/polyline';
import { html, raw } from './map-helpers';

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

export function buildPolylineFeature(encoded: string, popup: string): GeoJSON.Feature<GeoJSON.LineString> {
  const feature = decodeToGeoJson(encoded);
  feature.properties = { popup };
  return feature;
}

// --- Map initialization ---

export function initMap({ el, center, zoom, styleUrl }: MapOptions): maplibregl.Map {
  return new maplibregl.Map({
    container: el,
    style: styleUrl,
    center: [center[1], center[0]], // MapLibre uses [lng, lat]
    zoom,
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
): maplibregl.LngLatBounds | null {
  removeSourceAndLayers(map, 'route-polylines');

  const features = polylines.map((p) => buildPolylineFeature(p.encoded, p.popup));
  const sourceId = 'route-polylines';

  map.addSource(sourceId, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features },
  });

  map.addLayer({
    id: 'route-lines',
    type: 'line',
    source: sourceId,
    paint: {
      'line-color': '#350091',
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
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 14, 12, 18],
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
      'text-size': ['interpolate', ['linear'], ['zoom'], 6, 11, 12, 13],
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

function showPhotoPopup(
  map: maplibregl.Map,
  props: Record<string, any>,
  coords: [number, number],
  cdnUrl: string,
): void {
  const imgUrl = `${cdnUrl}/cdn-cgi/image/width=800,fit=scale-down/${props.key}`;
  const fullUrl = `${cdnUrl}/cdn-cgi/image/width=1600/${props.key}`;

  const routeLink = props.routeName && props.routeUrl
    ? html`<p class="photo-popup-route"><a href="${raw(props.routeUrl)}">${props.routeName}</a></p>` : '';
  const captionBlock = props.caption ? html`<p class="photo-popup-caption">${props.caption}</p>` : '';

  const popupHtml = html`
    <div class="photo-popup-content">
      <a href="${raw(fullUrl)}" target="_blank">
        <img src="${raw(imgUrl)}" alt="${props.caption || 'Photo'}"${raw(
          props.width && props.height ? ` style="aspect-ratio:${props.width}/${props.height};width:100%"` : ''
        )} />
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
    clusterRadius: 60,
    clusterMaxZoom: 15,
  });

  // Cluster circles — only show when zoomed in enough to be useful
  map.addLayer({
    id: 'photo-clusters',
    type: 'circle',
    source: sourceId,
    minzoom: 11,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#350091',
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 12, 15, 18],
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.7, 13, 0.85],
    },
  });

  // Cluster count labels
  map.addLayer({
    id: 'photo-cluster-count',
    type: 'symbol',
    source: sourceId,
    minzoom: 11,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': '{point_count_abbreviated}',
      'text-font': ['NotoSans_Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 15, 13],
    },
    paint: { 'text-color': '#ffffff' },
  });

  // Invisible layer for unclustered feature detection (queryable but not visible)
  map.addLayer({
    id: 'photo-unclustered',
    type: 'circle',
    source: sourceId,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-radius': 1,
      'circle-opacity': 0,
    },
  });

  // --- DOM photo bubble markers (circular thumbnails) ---
  const bubbleMarkers = new Map<string, maplibregl.Marker>();

  function syncPhotoBubbles() {
    const features = map.queryRenderedFeatures({ layers: ['photo-unclustered'] });
    const seen = new Set<string>();

    for (const f of features) {
      const key = f.properties!.key as string;
      if (seen.has(key)) continue;
      seen.add(key);

      if (!bubbleMarkers.has(key)) {
        const props = f.properties!;
        const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
        const thumbUrl = `${cdnUrl}/cdn-cgi/image/width=80,height=80,fit=cover/${props.key}`;

        const el = document.createElement('div');
        el.className = 'photo-bubble';
        el.innerHTML = `<img src="${thumbUrl}" alt="" loading="lazy" />`;

        el.addEventListener('mouseenter', () => {
          if (photosVisible.get(map) === false) return;
          const w = photoPopupMaxWidth(map.getZoom());
          preloadImage(`${cdnUrl}/cdn-cgi/image/width=${w * 2},fit=scale-down/${props.key}`);
          preloadImage(`${cdnUrl}/cdn-cgi/image/width=800,fit=scale-down/${props.key}`);
        });

        el.addEventListener('click', (e) => {
          e.stopPropagation();
          showPhotoPopup(map, props, coords, cdnUrl);
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

    // Preload popup images for visible photos at current zoom level
    if (photosVisible.get(map) !== false) {
      const popupWidth = photoPopupMaxWidth(map.getZoom() + 2);
      for (const key of seen) {
        preloadImage(`${cdnUrl}/cdn-cgi/image/width=${popupWidth * 2},fit=scale-down/${key}`);
      }
    }

    // Remove markers no longer visible (clustered or out of viewport)
    for (const [key, marker] of bubbleMarkers) {
      if (!seen.has(key)) {
        marker.remove();
        bubbleMarkers.delete(key);
      }
    }
  }

  map.on('idle', syncPhotoBubbles);
  photoBubbleSyncHandlers.set(map, syncPhotoBubbles);

  // Click to zoom into cluster
  map.on('click', 'photo-clusters', async (e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: ['photo-clusters'] });
    if (!features.length) return;
    const clusterId = features[0].properties?.cluster_id;
    const source = map.getSource(sourceId) as maplibregl.GeoJSONSource;
    const zoom = await source.getClusterExpansionZoom(clusterId);
    map.easeTo({ center: (features[0].geometry as GeoJSON.Point).coordinates as [number, number], zoom });
  });

  map.on('mouseenter', 'photo-clusters', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'photo-clusters', () => { map.getCanvas().style.cursor = ''; });
}

// --- GPS control ---

export function addGpsControl(map: maplibregl.Map): void {
  map.addControl(
    new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: false,
    }),
    'top-left',
  );
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
