import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import polylineCodec from '@mapbox/polyline';
import { html, raw } from './map-helpers';

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
    attributionControl: true,
  });
}

// --- Polylines ---

export function addPolylines(
  map: maplibregl.Map,
  polylines: PolylineOptions[],
): maplibregl.LngLatBounds | null {
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
      new maplibregl.Popup().setLngLat(e.lngLat).setHTML(props.popup).addTo(map);
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

// --- Emoji markers (places) ---

export function addMarkers(map: maplibregl.Map, markers: MarkerOptions[]): void {
  for (const m of markers) {
    const el = document.createElement('div');
    el.className = 'poi-marker';
    el.innerHTML = `<span class="poi-marker-emoji">${m.emoji}</span>`;

    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([m.lng, m.lat])
      .addTo(map);

    if (m.popup) {
      marker.setPopup(new maplibregl.Popup({ offset: 20, maxWidth: '320px' }).setHTML(m.popup));
    }
  }
}

// --- Photo markers (clustered) ---

export function addPhotoMarkers(
  map: maplibregl.Map,
  photos: PhotoMarkerOptions[],
  cdnUrl: string,
): void {
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
    clusterRadius: 40,
    clusterMaxZoom: 16,
  });

  // Cluster circles
  map.addLayer({
    id: 'photo-clusters',
    type: 'circle',
    source: sourceId,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#350091',
      'circle-radius': 18,
      'circle-opacity': 0.85,
    },
  });

  // Cluster count labels
  map.addLayer({
    id: 'photo-cluster-count',
    type: 'symbol',
    source: sourceId,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': '{point_count_abbreviated}',
      'text-size': 13,
    },
    paint: { 'text-color': '#ffffff' },
  });

  // Individual photo markers as circles
  map.addLayer({
    id: 'photo-unclustered',
    type: 'circle',
    source: sourceId,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': '#350091',
      'circle-radius': 6,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  });

  // Click to zoom into cluster
  map.on('click', 'photo-clusters', async (e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: ['photo-clusters'] });
    if (!features.length) return;
    const clusterId = features[0].properties?.cluster_id;
    const source = map.getSource(sourceId) as maplibregl.GeoJSONSource;
    const zoom = await source.getClusterExpansionZoom(clusterId);
    map.easeTo({ center: (features[0].geometry as GeoJSON.Point).coordinates as [number, number], zoom });
  });

  // Click individual photo — popup with image
  map.on('click', 'photo-unclustered', (e) => {
    if (!e.features?.length) return;
    const props = e.features[0].properties!;
    const coords = (e.features[0].geometry as GeoJSON.Point).coordinates as [number, number];
    const imgUrl = `${cdnUrl}/cdn-cgi/image/width=800,fit=scale-down/${props.key}`;
    const fullUrl = `${cdnUrl}/cdn-cgi/image/width=1600/${props.key}`;

    let sizeAttrs = '';
    if (props.width && props.height) {
      const displayWidth = Math.min(props.width, 500);
      const displayHeight = Math.round(displayWidth * props.height / props.width);
      sizeAttrs = ` width="${displayWidth}" height="${displayHeight}"`;
    }

    const routeLink = props.routeName && props.routeUrl
      ? html`<p class="photo-popup-route"><a href="${raw(props.routeUrl)}">${props.routeName}</a></p>` : '';
    const captionBlock = props.caption ? html`<p class="photo-popup-caption">${props.caption}</p>` : '';

    const popupHtml = html`
      <div class="photo-popup-content">
        <a href="${raw(fullUrl)}" target="_blank">
          <img src="${raw(imgUrl)}" alt="${props.caption || 'Photo'}"${raw(sizeAttrs)} />
        </a>
        ${raw(captionBlock)}
        ${raw(routeLink)}
      </div>
    `;
    new maplibregl.Popup({ maxWidth: '500px' }).setLngLat(coords).setHTML(popupHtml).addTo(map);
  });

  map.on('mouseenter', 'photo-unclustered', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'photo-unclustered', () => { map.getCanvas().style.cursor = ''; });
  map.on('mouseenter', 'photo-clusters', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'photo-clusters', () => { map.getCanvas().style.cursor = ''; });
}

// --- GPS control ---

export function addGpsControl(map: maplibregl.Map): void {
  map.addControl(
    new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: false,
      showUserHeading: false,
    }),
    'top-left',
  );
}

// --- Layer visibility helpers ---

const PHOTO_LAYER_IDS = ['photo-clusters', 'photo-cluster-count', 'photo-unclustered'];

export function setPhotoLayersVisible(map: maplibregl.Map, visible: boolean): void {
  const vis = visible ? 'visible' : 'none';
  for (const id of PHOTO_LAYER_IDS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
  }
}

export function setPlaceMarkersVisible(map: maplibregl.Map, visible: boolean): void {
  const markers = map.getContainer().querySelectorAll('.poi-marker');
  for (const el of markers) {
    (el as HTMLElement).style.display = visible ? '' : 'none';
  }
}
