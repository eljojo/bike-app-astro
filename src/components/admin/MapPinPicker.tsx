import { useRef, useEffect } from 'preact/hooks';
import { throttle } from '../../lib/throttle';
import { getStyleUrl, loadStylePreference } from '../../lib/maps/map-style-switch';

interface Props {
  /** Fallback center when lat/lng are 0 */
  center: [number, number];
  lat: number;
  lng: number;
  /** Called on click or drag — parent should update lat/lng state */
  onChange: (lat: number, lng: number) => void;
  /** Called after reverse geocoding a placed pin */
  onAddressChange?: (address: string) => void;
}

function round6(n: number): number {
  return Math.round(n * 1000000) / 1000000;
}

/**
 * Interactive map where the user can click or drag a pin to set a location.
 * Reverse geocodes the position via Nominatim (throttled to 1 req/sec).
 *
 * Used by PlaceWizard, CommunityWizard (bike-shop path), and PlaceEditor.
 */
export default function MapPinPicker({ center, lat, lng, onChange, onAddressChange }: Props) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<import('maplibre-gl').Map | null>(null);
  const markerRef = useRef<import('maplibre-gl').Marker | null>(null);
  const createMarkerRef = useRef<((position: [number, number]) => import('maplibre-gl').Marker) | null>(null);

  // Track whether the last position change was triggered internally (click/drag)
  // so we can distinguish it from external updates (prefill) in the effect below.
  const internalUpdate = useRef(false);
  const prevLatLng = useRef({ lat, lng });

  // Reverse geocode (throttled per Nominatim policy: 1 req/sec)
  const reverseGeocode = useRef(throttle(async (latitude: number, longitude: number) => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18`,
        { headers: { 'User-Agent': 'whereto.bike/1.0' } },
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.display_name) onAddressChange?.(data.display_name);
    } catch {
      // Geocoding is best-effort
    }
  }, 1100));

  function handleLocationChange(latitude: number, longitude: number) {
    const roundedLat = round6(latitude);
    const roundedLng = round6(longitude);

    // Update marker position on existing map
    if (mapInstanceRef.current) {
      if (markerRef.current) {
        markerRef.current.setLngLat([roundedLng, roundedLat]);
      } else if (createMarkerRef.current) {
        markerRef.current = createMarkerRef.current([roundedLat, roundedLng]);
      }
    }

    reverseGeocode.current(roundedLat, roundedLng);
    internalUpdate.current = true;
    onChange(roundedLat, roundedLng);
  }

  // React to external lat/lng changes (e.g. from prefill) — fly to new position
  useEffect(() => {
    if (internalUpdate.current) {
      internalUpdate.current = false;
      prevLatLng.current = { lat, lng };
      return;
    }
    if (lat !== prevLatLng.current.lat || lng !== prevLatLng.current.lng) {
      prevLatLng.current = { lat, lng };
      if (lat && lng && mapInstanceRef.current) {
        mapInstanceRef.current.flyTo({ center: [lng, lat], zoom: 15 });
        if (markerRef.current) {
          markerRef.current.setLngLat([lng, lat]);
        } else if (createMarkerRef.current) {
          markerRef.current = createMarkerRef.current([lat, lng]);
        }
      }
    }
  }, [lat, lng]);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    import('maplibre-gl').then(async (maplibregl) => {
      const { initMap } = await import('../../lib/maps/map-init');

      const defaultCenter: [number, number] = lat && lng ? [lat, lng] : center;
      const defaultZoom = lat && lng ? 15 : 11;

      const map = initMap({
        el: mapContainerRef.current!,
        center: defaultCenter,
        zoom: defaultZoom,
        styleUrl: getStyleUrl(loadStylePreference()),
      });

      function createDraggableMarker(position: [number, number]) {
        const el = document.createElement('div');
        el.className = 'place-picker-marker';

        const marker = new maplibregl.default.Marker({ element: el, draggable: true })
          .setLngLat([position[1], position[0]])
          .addTo(map);
        marker.on('dragend', () => {
          const lngLat = marker.getLngLat();
          handleLocationChange(lngLat.lat, lngLat.lng);
        });
        return marker;
      }

      createMarkerRef.current = createDraggableMarker;

      if (lat && lng) {
        markerRef.current = createDraggableMarker([lat, lng]);
      }

      map.on('click', (e) => {
        const { lat: clickLat, lng: clickLng } = e.lngLat;
        if (markerRef.current) {
          markerRef.current.setLngLat([clickLng, clickLat]);
        } else {
          markerRef.current = createDraggableMarker([clickLat, clickLng]);
        }
        handleLocationChange(clickLat, clickLng);
      });

      mapInstanceRef.current = map;
    });

    return () => {
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
      markerRef.current = null;
      createMarkerRef.current = null;
    };
  }, []);

  return (
    <div class="form-field">
      <label>Pin location <span class="field-hint">(click map to place)</span></label>
      <div ref={mapContainerRef} class="place-map-picker" />
      {(lat !== 0 || lng !== 0) && (
        <div class="place-coords">
          {lat.toFixed(6)}, {lng.toFixed(6)}
        </div>
      )}
    </div>
  );
}
