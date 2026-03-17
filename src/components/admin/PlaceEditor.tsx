// AGENTS.md: See src/components/admin/AGENTS.md for editor rules.
// Key: textarea hydration workaround required, contentHash must sync after save, all styles in admin.scss.
import { useState, useRef, useEffect, useMemo } from 'preact/hooks';
import { useEditorState } from './useEditorState';
import { useFormValidation } from './useFormValidation';
import { useUnsavedGuard } from '../../lib/hooks/use-unsaved-guard';
import PhotoField from './PhotoField';
import EditorActions from './EditorActions';
import { categoryEmoji } from '../../lib/geo/place-categories';
import { buildMediaThumbnailUrl } from '../../lib/media/image-service';
import type { MediaThumbnailConfig } from '../../lib/media/image-service';
import { getStyleUrl, loadStylePreference } from '../../lib/maps/map-style-switch';
import { haversineM, PHOTO_NEAR_PLACE_M } from '../../lib/geo/proximity';
import photoLocations from 'virtual:bike-app/media-locations';
import type { PlaceDetail } from '../../lib/models/place-model';
import type { PlaceUpdate } from '../../views/api/place-save';
import { localeLabel } from '../../lib/i18n/locale-utils';

interface Props {
  initialData: PlaceDetail & { contentHash?: string; isNew?: boolean };
  cdnUrl: string;
  videosCdnUrl?: string;
  videoPrefix?: string;
  userRole?: string;
  secondaryLocales?: string[];
  mapCenter?: [number, number]; // [lat, lng] — city default center for new places
}

const categories = Object.entries(categoryEmoji);

// Throttle: at most one call per interval
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function throttle<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: Parameters<T>) => {
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

const GMAPS_PATTERNS = [
  'maps.google.com',
  'google.com/maps',
  'goo.gl/maps',
  'maps.app.goo.gl',
];

function isGoogleMapsUrl(text: string): boolean {
  return GMAPS_PATTERNS.some(p => text.includes(p));
}

export default function PlaceEditor({ initialData, cdnUrl, videosCdnUrl, videoPrefix, userRole, secondaryLocales, mapCenter }: Props) {
  const thumbConfig: MediaThumbnailConfig = { cdnUrl, videosCdnUrl, videoPrefix };
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty);

  const [name, setName] = useState(initialData.name || '');

  const locales = secondaryLocales || [];
  const [translations, setTranslations] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const locale of locales) {
      const key = `name_${locale}`;
      initial[locale] = (initialData as Record<string, unknown>)[key] as string || '';
    }
    return initial;
  });

  function setTranslation(locale: string, value: string) {
    setTranslations(prev => ({ ...prev, [locale]: value }));
  }

  const [category, setCategory] = useState(initialData.category || 'other');
  const [lat, setLat] = useState(initialData.lat || 0);
  const [lng, setLng] = useState(initialData.lng || 0);
  const [address, setAddress] = useState(initialData.address || '');
  const [website, setWebsite] = useState(initialData.website || '');
  const [phone, setPhone] = useState(initialData.phone || '');
  const [googleMapsUrl, setGoogleMapsUrl] = useState(initialData.google_maps_url || '');
  const [photoKey, setPhotoKey] = useState(initialData.photo_key || '');
  const [prefilling, setPrefilling] = useState(false);

  const initialRender = useRef(true);
  useEffect(() => {
    if (initialRender.current) { initialRender.current = false; return; }
    setDirty(true);
  }, [name, translations, category, lat, lng, address, website, phone, googleMapsUrl, photoKey]);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<import('maplibre-gl').Map | null>(null);
  const markerRef = useRef<import('maplibre-gl').Marker | null>(null);
  const createMarkerRef = useRef<((position: [number, number]) => import('maplibre-gl').Marker) | null>(null);
  const lastPrefillQuery = useRef<string>('');

  const { validate } = useFormValidation([
    { field: 'place-name', check: () => !name.trim(), message: 'Name is required' },
    { field: 'place-category', check: () => !category, message: 'Category is required' },
    { field: '', check: () => !lat && !lng, message: 'Click on the map to set a location' },
  ]);

  const { saving, saved, error, githubUrl, save: handleSave, setError } = useEditorState({
    apiBase: '/api/places',
    contentId: initialData.isNew ? null : initialData.id,
    initialContentHash: initialData.contentHash,
    userRole,
    validate,
    buildPayload: () => {
      const payload: PlaceUpdate = {
        frontmatter: {
          name,
          category,
          lat,
          lng,
          ...Object.fromEntries(
            locales
              .filter(locale => translations[locale])
              .map(locale => [`name_${locale}`, translations[locale]])
          ),
          ...(address && { address }),
          ...(website && { website }),
          ...(phone && { phone }),
          ...(googleMapsUrl && { google_maps_url: googleMapsUrl }),
          ...(photoKey && { photo_key: photoKey }),
        },
      };
      return payload as unknown as Record<string, unknown>;
    },
    onSuccess: (result) => {
      setDirty(false);
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

    // Update or create marker on existing map
    if (mapInstanceRef.current) {
      if (markerRef.current) {
        markerRef.current.setLngLat([longitude, latitude]);
      } else if (createMarkerRef.current) {
        markerRef.current = createMarkerRef.current([latitude, longitude]);
      }
    }
  }

  // Filter photos near the current location
  const nearbyPhotos = useMemo(() => {
    if (!lat || !lng) return [];
    return photoLocations
      .filter((p) => haversineM(lat, lng, p.lat, p.lng) <= PHOTO_NEAR_PLACE_M)
      .sort((a, b) => haversineM(lat, lng, a.lat, a.lng) - haversineM(lat, lng, b.lat, b.lng))
      .slice(0, 12);
  }, [lat, lng]);

  async function handlePrefill() {
    const query = googleMapsUrl.trim();
    if (!query || query === lastPrefillQuery.current) return;
    lastPrefillQuery.current = query;
    setPrefilling(true);
    setError('');
    try {
      const res = await fetch('/api/places/prefill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Prefill failed');
        return;
      }
      if (data.name) setName(data.name);
      if (data.address) setAddress(data.address);
      if (data.phone) setPhone(data.phone);
      if (data.website) setWebsite(data.website);
      if (data.google_maps_url) setGoogleMapsUrl(data.google_maps_url);
      if (data.category && category === 'other') {
        setCategory(data.category);
      }
      if (data.lat && data.lng) {
        updateLocation(data.lat, data.lng);
        if (mapInstanceRef.current) {
          mapInstanceRef.current.flyTo({ center: [data.lng, data.lat], zoom: 15 });
        }
      }
    } catch {
      setError('Prefill request failed');
    } finally {
      setPrefilling(false);
    }
  }

  function handlePaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData('text')?.trim();
    if (text && isGoogleMapsUrl(text)) {
      setTimeout(() => handlePrefill(), 0);
    }
  }

  function handleBlur() {
    const query = googleMapsUrl.trim();
    if (query && isGoogleMapsUrl(query)) {
      handlePrefill();
    }
  }

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    import('maplibre-gl').then(async (maplibregl) => {
      const { initMap } = await import('../../lib/maps/map-init');

      const defaultCenter: [number, number] = lat && lng ? [lat, lng] : (mapCenter || [45.4215, -75.6972]);
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
          .setLngLat([position[1], position[0]]) // position is [lat, lng], MapLibre wants [lng, lat]
          .addTo(map);
        marker.on('dragend', () => {
          const lngLat = marker.getLngLat();
          updateLocation(lngLat.lat, lngLat.lng);
        });
        return marker;
      }

      createMarkerRef.current = createDraggableMarker;

      // Add marker at current position
      if (lat && lng) {
        markerRef.current = createDraggableMarker([lat, lng]);
      }

      // Click to place/move marker
      map.on('click', (e) => {
        const { lat: clickLat, lng: clickLng } = e.lngLat;
        if (markerRef.current) {
          markerRef.current.setLngLat([clickLng, clickLat]);
        } else {
          markerRef.current = createDraggableMarker([clickLat, clickLng]);
        }
        updateLocation(clickLat, clickLng);
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

  const googleMapsField = (
    <div class="form-field">
      <label for="place-google-maps">
        Google Maps URL{initialData.isNew ? '' : ' or place name'}
      </label>
      {initialData.isNew && (
        <p class="field-hint-block">Paste a Google Maps link to auto-fill all fields below</p>
      )}
      <div class="prefill-row">
        <input id="place-google-maps" type="text" value={googleMapsUrl}
          placeholder={initialData.isNew ? 'https://maps.google.com/...' : 'https://maps.google.com/... or place name'}
          onInput={(e) => setGoogleMapsUrl((e.target as HTMLInputElement).value)}
          onPaste={handlePaste}
          onBlur={handleBlur} />
        <button type="button" class="btn-secondary btn-prefill" onClick={handlePrefill}
          disabled={prefilling || !googleMapsUrl.trim()}>
          {prefilling ? 'Loading...' : 'Prefill'}
        </button>
      </div>
    </div>
  );

  return (
    <div class="place-editor">
      <div class="auth-form">
        {initialData.isNew && googleMapsField}

        <div class="form-field">
          <label for="place-name">Name</label>
          <input id="place-name" type="text" value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </div>

        {locales.map(locale => (
          <div class="form-field" key={locale}>
            <label for={`place-name-${locale}`}>Name ({localeLabel(locale)})</label>
            <input id={`place-name-${locale}`} type="text" value={translations[locale] || ''}
              onInput={(e) => setTranslation(locale, (e.target as HTMLInputElement).value)} />
          </div>
        ))}

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
          <div ref={mapContainerRef} class="place-map-picker" />
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

        {!initialData.isNew && googleMapsField}

        <PhotoField
          photoKey={photoKey}
          cdnUrl={cdnUrl}
          label="Photo"
          onPhotoChange={(key) => {
            setPhotoKey(key);
          }}
        />

        {!photoKey && lat !== 0 && lng !== 0 && nearbyPhotos.length > 0 && (
          <div class="form-field">
            <label>Nearby photos <span class="field-hint">(click to use)</span></label>
            <div class="nearby-media-grid">
              {nearbyPhotos.map((photo) => (
                <button
                  key={photo.key}
                  type="button"
                  class="nearby-media-btn"
                  title={photo.caption || photo.routeSlug}
                  onClick={() => {
                    setPhotoKey(photo.key);
                  }}
                >
                  <img src={buildMediaThumbnailUrl(photo, thumbConfig, { width: 120, height: 120, fit: 'cover' })} alt={photo.caption || ''} />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <EditorActions
        error={error} githubUrl={githubUrl} saved={saved} saving={saving}
        onSave={handleSave} contentType="place" userRole={userRole}
        viewLink="/admin/places"
      />
    </div>
  );
}
