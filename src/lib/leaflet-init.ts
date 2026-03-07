import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import polylineCodec from '@mapbox/polyline';
import { addGpsControl } from './leaflet-controls';

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
    const icon = L.divIcon({ className: 'emoji-icon', html: m.emoji, iconSize: [25, 25] });
    L.marker([m.lat, m.lng], { icon }).bindPopup(m.popup).addTo(map);
  }
}

export interface PhotoMarkerOptions {
  key: string;
  lat: number;
  lng: number;
  caption?: string;
  index: number;
}

export type PhotoMarkerMode = 'off' | 'icons' | 'thumbnails';

/**
 * Add photo markers to the map. Returns a layer group that can be toggled.
 */
export function addPhotoMarkers(
  map: L.Map,
  photos: PhotoMarkerOptions[],
  cdnUrl: string,
  mode: PhotoMarkerMode,
  onPhotoClick: (index: number) => void,
): L.LayerGroup {
  const group = L.layerGroup();

  for (const photo of photos) {
    let icon: L.DivIcon;
    if (mode === 'thumbnails') {
      const thumbUrl = `${cdnUrl}/cdn-cgi/image/width=80,height=80,fit=cover/${photo.key}`;
      icon = L.divIcon({
        className: 'photo-marker-thumb',
        html: `<img src="${thumbUrl}" alt="${photo.caption || ''}" loading="lazy" />`,
        iconSize: [40, 40],
      });
    } else {
      icon = L.divIcon({
        className: 'photo-marker-icon',
        html: '\u{1F4F7}',
        iconSize: [25, 25],
      });
    }

    const marker = L.marker([photo.lat, photo.lng], { icon });
    if (photo.caption) {
      marker.bindPopup(photo.caption);
    }
    marker.on('click', () => onPhotoClick(photo.index));
    marker.addTo(group);
  }

  return group;
}

/**
 * Create a Leaflet control button that cycles photo marker modes.
 */
export function addPhotoToggle(
  map: L.Map,
  photos: PhotoMarkerOptions[],
  cdnUrl: string,
  onPhotoClick: (index: number) => void,
): void {
  if (photos.length === 0) return;

  const modes: PhotoMarkerMode[] = ['off', 'icons', 'thumbnails'];
  const labels = ['\u{1F4F7} Off', '\u{1F4F7} Pins', '\u{1F4F7} Photos'];
  let currentIndex = 0;
  let currentLayer: L.LayerGroup | null = null;

  const Control = L.Control.extend({
    options: { position: 'topright' as L.ControlPosition },
    onAdd() {
      const btn = L.DomUtil.create('button', 'leaflet-photo-toggle leaflet-bar');
      btn.type = 'button';
      btn.title = 'Toggle photo markers';
      btn.textContent = labels[0];
      btn.style.cssText = 'padding: 4px 8px; cursor: pointer; font-size: 14px; background: white; border: none;';

      L.DomEvent.disableClickPropagation(btn);
      btn.addEventListener('click', () => {
        if (currentLayer) {
          map.removeLayer(currentLayer);
          currentLayer = null;
        }
        currentIndex = (currentIndex + 1) % modes.length;
        btn.textContent = labels[currentIndex];
        const mode = modes[currentIndex];
        if (mode !== 'off') {
          currentLayer = addPhotoMarkers(map, photos, cdnUrl, mode, onPhotoClick);
          currentLayer.addTo(map);
        }
      });

      return btn;
    },
  });

  new Control().addTo(map);
}
