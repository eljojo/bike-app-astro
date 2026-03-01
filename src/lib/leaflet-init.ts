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
