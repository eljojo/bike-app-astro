import { useState, useRef, useEffect } from 'preact/hooks';
import { useEditorState } from './useEditorState';
import PhotoField from './PhotoField';
import SaveSuccessModal from './SaveSuccessModal';
import { categoryEmoji } from '../../lib/place-categories';
import type { PlaceDetail } from '../../lib/models/place-model';
import type { PlaceUpdate } from '../../views/api/place-save';

interface Props {
  initialData: PlaceDetail & { contentHash?: string; isNew?: boolean };
  cdnUrl: string;
  userRole?: string;
}

const categories = Object.entries(categoryEmoji);

// Throttle: at most one call per interval
function throttle<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: unknown[]) => {
    const now = Date.now();
    const remaining = ms - (now - last);
    if (remaining <= 0) {
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        fn(...args);
      }, remaining);
    }
  }) as T;
}

export default function PlaceEditor({ initialData, cdnUrl, userRole }: Props) {
  const [name, setName] = useState(initialData.name || '');
  const [nameFr, setNameFr] = useState(initialData.name_fr || '');
  const [category, setCategory] = useState(initialData.category || 'other');
  const [lat, setLat] = useState(initialData.lat || 0);
  const [lng, setLng] = useState(initialData.lng || 0);
  const [address, setAddress] = useState(initialData.address || '');
  const [website, setWebsite] = useState(initialData.website || '');
  const [phone, setPhone] = useState(initialData.phone || '');
  const [googleMapsUrl, setGoogleMapsUrl] = useState(initialData.google_maps_url || '');
  const [photoKey, setPhotoKey] = useState(initialData.photo_key || '');
  const [photoContentType, setPhotoContentType] = useState(initialData.photo_content_type || '');

  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  const { saving, saved, error, githubUrl, save: handleSave, setError } = useEditorState({
    apiBase: '/api/places',
    contentId: initialData.isNew ? null : initialData.id,
    initialContentHash: initialData.contentHash,
    userRole,
    validate: () => {
      if (!name.trim()) {
        document.getElementById('place-name')?.focus();
        return 'Name is required';
      }
      if (!category) return 'Category is required';
      if (!lat && !lng) return 'Click on the map to set a location';
      return null;
    },
    buildPayload: () => {
      const payload: PlaceUpdate = {
        frontmatter: {
          name,
          category,
          lat,
          lng,
          ...(nameFr && { name_fr: nameFr }),
          ...(address && { address }),
          ...(website && { website }),
          ...(phone && { phone }),
          ...(googleMapsUrl && { google_maps_url: googleMapsUrl }),
          ...(photoKey && { photo_key: photoKey, photo_content_type: photoContentType || 'image/jpeg' }),
        },
      };
      return payload as unknown as Record<string, unknown>;
    },
    onSuccess: (result) => {
      if (initialData.isNew && result.id) {
        window.location.href = `/admin/places/${result.id}`;
      }
    },
  });

  // Reverse geocode on map click (throttled to 1 req/sec per Nominatim policy)
  const reverseGeocode = useRef(throttle(async (latitude: number, longitude: number) => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18`,
        { headers: { 'User-Agent': 'OttawaByBike/1.0' } }
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.display_name) {
        setAddress(data.display_name);
      }
    } catch {
      // Geocoding is best-effort
    }
  }, 1100));

  function updateLocation(latitude: number, longitude: number) {
    setLat(Math.round(latitude * 1000000) / 1000000);
    setLng(Math.round(longitude * 1000000) / 1000000);
    reverseGeocode.current(latitude, longitude);

    // Update marker on existing map
    if (leafletMapRef.current && markerRef.current) {
      markerRef.current.setLatLng([latitude, longitude]);
    }
  }

  // Initialize map
  useEffect(() => {
    if (!mapRef.current) return;

    import('leaflet').then((L) => {
      import('leaflet/dist/leaflet.css');

      const defaultCenter: [number, number] = lat && lng ? [lat, lng] : [45.4215, -75.6972]; // Ottawa default
      const defaultZoom = lat && lng ? 15 : 11;

      const map = L.default.map(mapRef.current!, { scrollWheelZoom: true })
        .setView(defaultCenter, defaultZoom);

      L.default.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      // Add marker at current position
      if (lat && lng) {
        const marker = L.default.marker([lat, lng], { draggable: true }).addTo(map);
        marker.on('dragend', () => {
          const pos = marker.getLatLng();
          updateLocation(pos.lat, pos.lng);
        });
        markerRef.current = marker;
      }

      // Click to place/move marker
      map.on('click', (e: L.LeafletMouseEvent) => {
        const { lat: clickLat, lng: clickLng } = e.latlng;
        if (markerRef.current) {
          markerRef.current.setLatLng([clickLat, clickLng]);
        } else {
          const marker = L.default.marker([clickLat, clickLng], { draggable: true }).addTo(map);
          marker.on('dragend', () => {
            const pos = marker.getLatLng();
            updateLocation(pos.lat, pos.lng);
          });
          markerRef.current = marker;
        }
        updateLocation(clickLat, clickLng);
      });

      leafletMapRef.current = map;
    });

    return () => {
      leafletMapRef.current?.remove();
      leafletMapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  return (
    <div class="place-editor">
      <div class="auth-form">
        <div class="form-field">
          <label for="place-name">Name</label>
          <input id="place-name" type="text" value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </div>

        <div class="form-field">
          <label for="place-name-fr">Name (French)</label>
          <input id="place-name-fr" type="text" value={nameFr}
            onInput={(e) => setNameFr((e.target as HTMLInputElement).value)} />
        </div>

        <div class="form-field">
          <label for="place-category">Category</label>
          <select id="place-category" value={category}
            onChange={(e) => setCategory((e.target as HTMLSelectElement).value)}>
            {categories.map(([key, emoji]) => (
              <option key={key} value={key}>{emoji} {key.replace(/-/g, ' ')}</option>
            ))}
          </select>
        </div>

        <div class="form-field">
          <label>Location <span class="field-hint">(click map to set)</span></label>
          <div ref={mapRef} class="place-map-picker" />
          {(lat !== 0 || lng !== 0) && (
            <div class="place-coords">
              {lat.toFixed(6)}, {lng.toFixed(6)}
            </div>
          )}
        </div>

        <div class="form-field">
          <label for="place-address">Address</label>
          <input id="place-address" type="text" value={address}
            onInput={(e) => setAddress((e.target as HTMLInputElement).value)} />
        </div>

        <div class="form-field">
          <label for="place-website">Website</label>
          <input id="place-website" type="url" value={website}
            placeholder="https://"
            onInput={(e) => setWebsite((e.target as HTMLInputElement).value)} />
        </div>

        <div class="form-field">
          <label for="place-phone">Phone</label>
          <input id="place-phone" type="tel" value={phone}
            onInput={(e) => setPhone((e.target as HTMLInputElement).value)} />
        </div>

        <div class="form-field">
          <label for="place-google-maps">Google Maps URL</label>
          <input id="place-google-maps" type="url" value={googleMapsUrl}
            placeholder="https://maps.google.com/..."
            onInput={(e) => setGoogleMapsUrl((e.target as HTMLInputElement).value)} />
        </div>

        <PhotoField
          photoKey={photoKey}
          cdnUrl={cdnUrl}
          label="Photo"
          onPhotoChange={(key, contentType) => {
            setPhotoKey(key);
            setPhotoContentType(contentType);
          }}
        />
      </div>

      <div class="editor-actions">
        {error && !githubUrl && <div class="auth-error">{error}</div>}
        {githubUrl && (
          <div class="conflict-notice">
            <strong>Save blocked — this place was changed on GitHub</strong>
            <p>Someone modified this place since you started editing.</p>
            <a href={githubUrl} target="_blank" rel="noopener" class="btn-primary"
              style="display: inline-block; margin-top: 0.5rem; text-decoration: none;">
              View file on GitHub
            </a>
          </div>
        )}
        {saved && userRole === 'guest' && (
          <SaveSuccessModal
            viewLink="/admin/places"
            onClose={() => {}}
          />
        )}
        {saved && userRole !== 'guest' && (
          <div class="save-success">
            Saved! Your edit will be live in a few minutes.
          </div>
        )}
        <p class="editor-license-notice">
          By saving, you agree to release your contribution under{' '}
          <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>.
        </p>
        <button type="button" class="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}
