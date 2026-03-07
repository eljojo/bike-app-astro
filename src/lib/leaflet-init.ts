import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import polylineCodec from '@mapbox/polyline';
import { addGpsControl } from './leaflet-controls';
import { html, raw } from './map-helpers';

interface MapOptions {
  el: HTMLElement;
  center: [number, number];
  zoom: number;
  tilesUrl: string;
}

interface PolylineOptions {
  encoded: string;
  popup: string;
}

interface MarkerOptions {
  lat: number;
  lng: number;
  emoji: string;
  popup: string;
}

/**
 * Initialize a Leaflet map with tile layer, polylines, emoji markers, and GPS control.
 * Returns the map instance and its cumulative bounds for optional fitBounds.
 */
export function initMap({ el, center, zoom, tilesUrl }: MapOptions) {
  const map = L.map(el).setView(center, zoom);

  L.tileLayer(tilesUrl, {
    maxZoom: 20,
    attribution: 'Maps &copy; <a href="https://www.thunderforest.com">Thunderforest</a>, Data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  }).addTo(map);

  addGpsControl(map);
  return map;
}

export function addPolylines(map: L.Map, polylines: PolylineOptions[]) {
  const bounds = L.latLngBounds([]);
  for (const pl of polylines) {
    const coords = polylineCodec.decode(pl.encoded);
    const line = L.polyline(coords, { color: '#350091', weight: 6, opacity: 0.9 }).addTo(map);
    line.bindPopup(pl.popup);
    bounds.extend(line.getBounds());
  }
  return bounds;
}

export function addMarkers(map: L.Map, markers: MarkerOptions[]) {
  for (const m of markers) {
    const icon = L.divIcon({
      className: 'poi-marker',
      html: `<span class="poi-marker-emoji">${m.emoji}</span>`,
      iconSize: [34, 34],
    });
    L.marker([m.lat, m.lng], { icon, zIndexOffset: 1000 }).bindPopup(m.popup).addTo(map);
  }
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

export type PhotoMarkerMode = 'off' | 'thumbnails';

/**
 * Add photo markers to the map with clustering. Returns a marker cluster group that can be toggled.
 */
export function addPhotoMarkers(
  map: L.Map,
  photos: PhotoMarkerOptions[],
  cdnUrl: string,
  onPhotoClick: (photo: PhotoMarkerOptions) => void,
): L.MarkerClusterGroup {
  const group = L.markerClusterGroup({
    maxClusterRadius: 40,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    iconCreateFunction: (cluster) => {
      const count = cluster.getChildCount();
      return L.divIcon({
        html: `<span>${count}</span>`,
        className: 'photo-cluster-icon',
        iconSize: [36, 36],
      });
    },
  });

  for (const photo of photos) {
    const thumbUrl = `${cdnUrl}/cdn-cgi/image/width=80,height=80,fit=cover/${photo.key}`;
    const icon = L.divIcon({
      className: 'photo-marker-thumb',
      html: html`<img src="${thumbUrl}" alt="${photo.caption || ''}" loading="lazy" />`,
      iconSize: [40, 40],
    });

    const marker = L.marker([photo.lat, photo.lng], { icon });
    marker.on('click', () => onPhotoClick(photo));
    marker.addTo(group);
  }

  return group;
}

/**
 * Build the photo popup callback for map pages (no gallery).
 * Shows the photo in a large Leaflet popup anchored to the marker location.
 */
export function makePhotoPopupHandler(map: L.Map, cdnUrl: string): (photo: PhotoMarkerOptions) => void {
  return (photo) => {
    const imgUrl = `${cdnUrl}/cdn-cgi/image/width=800,fit=scale-down/${photo.key}`;
    const fullUrl = `${cdnUrl}/cdn-cgi/image/width=1600/${photo.key}`;
    const routeLink = photo.routeUrl && photo.routeName
      ? html`<p class="photo-popup-route"><a href="${photo.routeUrl}">${photo.routeName}</a></p>` : '';
    const captionBlock = photo.caption ? html`<p class="photo-popup-caption">${photo.caption}</p>` : '';

    // Pre-compute proportional image size so popup doesn't resize after load
    const popupWidth = 500;
    let sizeAttrs = '';
    if (photo.width && photo.height) {
      const displayWidth = Math.min(photo.width, popupWidth);
      const displayHeight = Math.round(displayWidth * photo.height / photo.width);
      sizeAttrs = ` width="${displayWidth}" height="${displayHeight}"`;
    }

    L.popup({
      maxWidth: 500,
      minWidth: 280,
      className: 'photo-popup',
    })
      .setLatLng([photo.lat, photo.lng])
      .setContent(html`
        <div class="photo-popup-content">
          <a href="${fullUrl}" target="_blank">
            <img src="${imgUrl}" alt="${photo.caption || 'Photo'}"${raw(sizeAttrs)} />
          </a>
          ${raw(captionBlock)}
          ${raw(routeLink)}
        </div>
      `)
      .openOn(map);
  };
}

const PHOTO_TOGGLE_KEY = 'map-photos-visible';

/**
 * Create a Leaflet control button that toggles photo markers on/off.
 * Remembers state in localStorage; defaults to on.
 */
export function addPhotoToggle(
  map: L.Map,
  photos: PhotoMarkerOptions[],
  cdnUrl: string,
  onPhotoClick: (photo: PhotoMarkerOptions) => void,
): void {
  if (photos.length === 0) return;

  let visible = localStorage.getItem(PHOTO_TOGGLE_KEY) !== 'off';
  let currentLayer: L.LayerGroup | null = null;

  function show() {
    currentLayer = addPhotoMarkers(map, photos, cdnUrl, onPhotoClick);
    currentLayer.addTo(map);
  }

  function hide() {
    if (currentLayer) {
      map.removeLayer(currentLayer);
      currentLayer = null;
    }
  }

  // Show photos on load if enabled
  if (visible) show();

  const Control = L.Control.extend({
    options: { position: 'topleft' as L.ControlPosition },
    onAdd() {
      const btn = L.DomUtil.create('button', 'leaflet-photo-toggle leaflet-bar');
      btn.type = 'button';
      btn.title = 'Toggle photo markers';
      btn.textContent = visible ? '\u{1F4F7} Photos' : '\u{1F4F7} Off';
      btn.style.cssText = 'padding: 4px 8px; cursor: pointer; font-size: 14px; background: white; border: none;';

      L.DomEvent.disableClickPropagation(btn);
      btn.addEventListener('click', () => {
        visible = !visible;
        localStorage.setItem(PHOTO_TOGGLE_KEY, visible ? 'on' : 'off');
        if (visible) {
          show();
          btn.textContent = '\u{1F4F7} Photos';
        } else {
          hide();
          btn.textContent = '\u{1F4F7} Off';
        }
      });

      return btn;
    },
  });

  new Control().addTo(map);
}
