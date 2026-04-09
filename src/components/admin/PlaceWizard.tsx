// AGENTS.md: See src/components/admin/AGENTS.md for editor rules.
// Key: use class not className, useHydrated required, all styles in admin.scss.
import { useState, useRef, useEffect } from 'preact/hooks';
import WizardLayout, { WizardNav } from './WizardLayout';
import { useFormValidation } from './useFormValidation';
import { useEditorForm } from './useEditorForm';
import { bindText } from './field-helpers';
import PhotoField from './PhotoField';
import { categoryEmoji } from '../../lib/geo/place-categories';
import { getStyleUrl, loadStylePreference } from '../../lib/maps/map-style-switch';
import { slugify } from '../../lib/slug';
import type { PlaceUpdate } from '../../views/api/place-save';

const STOPS = ['Find', 'Describe', 'Photo', 'Go Live'];

const GMAPS_PATTERNS = [
  'maps.google.com',
  'google.com/maps',
  'goo.gl/maps',
  'maps.app.goo.gl',
];

function isGoogleMapsUrl(text: string): boolean {
  return GMAPS_PATTERNS.some(p => text.includes(p));
}

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

interface Props {
  cdnUrl: string;
  videosCdnUrl?: string;
  videoPrefix?: string;
  userRole?: string;
  showLicenseNotice?: boolean;
  guestLabel?: string;
  mapCenter: [number, number];
  cityName?: string;
  mediaLocations?: Array<{ key: string; lat: number; lng: number; routeSlug: string; caption?: string; width?: number; height?: number; type?: 'photo' | 'video' }>;
  organizers?: Array<{ slug: string; name: string }>;
  categories: Array<[string, string]>; // [key, emoji] pairs
}

const allCategories = Object.entries(categoryEmoji);

export default function PlaceWizard({
  cdnUrl,
  userRole,
  showLicenseNotice,
  guestLabel,
  mapCenter,
  cityName,
}: Props) {
  const [step, setStep] = useState(0);
  const [skippedSteps, setSkippedSteps] = useState<string[]>([]);

  function skipStep(field: string, nextStep: number) {
    setSkippedSteps(prev => [...prev, field]);
    setStep(nextStep);
  }

  // Step 1 — Find it
  const [googleMapsUrl, setGoogleMapsUrl] = useState('');
  const [prefilling, setPrefilling] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const lastPrefillQuery = useRef<string>('');

  // Step 2 — Describe
  const [name, setName] = useState('');
  const [category, setCategory] = useState('other');
  const [vibe, setVibe] = useState('');
  const [address, setAddress] = useState('');
  const [website, setWebsite] = useState('');
  const [phone, setPhone] = useState('');

  // Location state (shared across steps)
  const [lat, setLat] = useState(0);
  const [lng, setLng] = useState(0);

  // Step 3 — Photo
  const [photoKey, setPhotoKey] = useState('');

  // Map refs (used in step 1 for manual pin)
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<import('maplibre-gl').Map | null>(null);
  const markerRef = useRef<import('maplibre-gl').Marker | null>(null);
  const createMarkerRef = useRef<((position: [number, number]) => import('maplibre-gl').Marker) | null>(null);

  // Reverse geocode on map click (throttled to 1 req/sec per Nominatim policy)
  const reverseGeocode = useRef(throttle(async (latitude: number, longitude: number) => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18`,
        { headers: { 'User-Agent': 'whereto.bike/1.0' } }
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

    if (mapInstanceRef.current) {
      if (markerRef.current) {
        markerRef.current.setLngLat([longitude, latitude]);
      } else if (createMarkerRef.current) {
        markerRef.current = createMarkerRef.current([latitude, longitude]);
      }
    }
  }

  // Initialize map when showMap becomes true (step 1 manual pin)
  useEffect(() => {
    if (!showMap || !mapContainerRef.current) return;

    import('maplibre-gl').then(async (maplibregl) => {
      const { initMap } = await import('../../lib/maps/map-init');

      const defaultCenter: [number, number] = lat && lng ? [lat, lng] : mapCenter;
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
          updateLocation(lngLat.lat, lngLat.lng);
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
  }, [showMap, step]);

  async function handlePrefill() {
    const query = googleMapsUrl.trim();
    if (!query || query === lastPrefillQuery.current) return;
    lastPrefillQuery.current = query;
    setPrefilling(true);
    editor.setError('');
    try {
      const res = await fetch(`/api/places/prefill?url=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!res.ok) {
        editor.setError(data.error || 'Prefill failed');
        return;
      }
      if (data.name) setName(data.name);
      if (data.address) setAddress(data.address);
      if (data.phone) setPhone(data.phone);
      if (data.website) setWebsite(data.website);
      if (data.category && category === 'other') setCategory(data.category);
      if (data.lat && data.lng) {
        updateLocation(data.lat, data.lng);
        if (mapInstanceRef.current) {
          mapInstanceRef.current.flyTo({ center: [data.lng, data.lat], zoom: 15 });
        }
      }
      setStep(2);
    } catch {
      editor.setError('Prefill request failed');
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

  // Validation
  const { validate } = useFormValidation([
    { field: 'wizard-place-name', check: () => !name.trim(), message: 'Name is required' },
    { field: 'wizard-place-category', check: () => !category, message: 'Category is required' },
    { field: '', check: () => !lat && !lng, message: 'Click on the map to set a location, or use a Google Maps link' },
  ]);

  const editor = useEditorForm({
    apiBase: '/api/places',
    contentId: null,
    userRole,
    validate,
    deps: [name, category, lat, lng, address, vibe, website, phone, googleMapsUrl, photoKey],
    buildPayload: () => {
      const payload: PlaceUpdate = {
        frontmatter: {
          name,
          category,
          lat,
          lng,
          ...(vibe && { vibe }),
          good_for: [],
          ...(address && { address }),
          ...(website && { website }),
          ...(phone && { phone }),
          ...(googleMapsUrl && { google_maps_url: googleMapsUrl }),
          ...(photoKey && { photo_key: photoKey }),
          social_links: [],
        },
      };
      return payload as unknown as Record<string, unknown>;
    },
    onSuccess: (result) => {
      const id = result?.id || slugify(name);
      const qs = new URLSearchParams({
        first: 'true',
        ...(skippedSteps.length > 0 ? { skipped: skippedSteps.join(',') } : {}),
      });
      window.location.href = `/admin/celebrate/place/${id}?${qs}`;
    },
  });

  // --- Step renderers ---

  function renderWelcome() {
    return (
      <div class="wizard-welcome">
        <h1 class="wizard-welcome-heading">
          Add a place cyclists should know about
        </h1>
        <p class="wizard-welcome-body">
          Cafes, viewpoints, bike shops, swim spots — anything that makes a ride worth taking.
          {cityName ? ` You're adding to ${cityName}.` : ''}
        </p>
        <div class="wizard-welcome-begin">
          <button type="button" class="btn-primary" onClick={() => setStep(1)}>
            Let's go
          </button>
        </div>
      </div>
    );
  }

  function renderFind() {
    return (
      <>
        <h2 class="wizard-step-heading">Find it</h2>
        <p class="wizard-step-subheading">
          Paste a Google Maps link to fill in the details automatically.
        </p>
        <div class="auth-form">
          <div class="form-field">
            <label for="wizard-place-gmaps">Google Maps link</label>
            <p class="field-hint-block">Paste a Google Maps link and we'll auto-fill the name, address, and category.</p>
            <div class="prefill-row">
              <input
                id="wizard-place-gmaps"
                type="text"
                value={googleMapsUrl}
                placeholder="https://maps.google.com/..."
                onInput={(e) => setGoogleMapsUrl((e.target as HTMLInputElement).value)}
                onPaste={handlePaste}
                onBlur={handleBlur}
              />
              <button
                type="button"
                class="btn-secondary btn-prefill"
                onClick={handlePrefill}
                disabled={prefilling || !googleMapsUrl.trim()}
              >
                {prefilling ? 'Loading...' : 'Prefill'}
              </button>
            </div>
          </div>

          {!showMap && (
            <div class="creator-divider"><span>or</span></div>
          )}

          {!showMap ? (
            <button
              type="button"
              class="btn-secondary"
              onClick={() => setShowMap(true)}
            >
              Place a pin manually
            </button>
          ) : (
            <div class="form-field">
              <label>Pin location <span class="field-hint">(click map to place)</span></label>
              <div ref={mapContainerRef} class="place-map-picker" />
              {(lat !== 0 || lng !== 0) && (
                <div class="place-coords">
                  {lat.toFixed(6)}, {lng.toFixed(6)}
                </div>
              )}
            </div>
          )}
        </div>
        {editor.error && <div class="auth-error">{editor.error}</div>}
        <WizardNav
          onBack={() => setStep(0)}
          onNext={() => {
            editor.setError('');
            setStep(2);
          }}
          nextLabel="Continue"
        />
      </>
    );
  }

  function renderDescribe() {
    return (
      <>
        <h2 class="wizard-step-heading">Describe it</h2>
        <div class="auth-form">
          <div class="form-field">
            <label for="wizard-place-name">Name</label>
            <input id="wizard-place-name" type="text" {...bindText(name, setName)} placeholder="e.g. Bridgehead on Elgin" />
          </div>

          <div class="form-field">
            <label for="wizard-place-category">Category</label>
            <select
              id="wizard-place-category"
              value={category}
              onChange={(e) => setCategory((e.target as HTMLSelectElement).value)}
            >
              {allCategories.map(([key, emoji]) => (
                <option key={key} value={key}>{emoji} {key.replace(/-/g, ' ')}</option>
              ))}
            </select>
          </div>

          <div class="form-field">
            <label for="wizard-place-vibe">Vibe <span class="field-hint">(one-liner)</span></label>
            <input
              id="wizard-place-vibe"
              type="text"
              {...bindText(vibe, setVibe)}
              placeholder="What makes this place worth the detour"
            />
          </div>
        </div>
        {editor.error && <div class="auth-error">{editor.error}</div>}
        <WizardNav
          onBack={() => setStep(1)}
          onNext={() => {
            const err = validate();
            if (err) { editor.setError(err); return; }
            editor.setError('');
            setStep(3);
          }}
          nextDisabled={!name.trim()}
        />
      </>
    );
  }

  function renderPhoto() {
    return (
      <>
        <h2 class="wizard-step-heading">Add a photo</h2>
        <p class="wizard-step-subheading">
          A photo helps people recognise the place. You can skip this and add one later.
        </p>
        <div class="auth-form">
          <PhotoField
            photoKey={photoKey}
            cdnUrl={cdnUrl}
            label="Photo"
            onPhotoChange={(key) => {
              setPhotoKey(key);
            }}
          />
        </div>
        <WizardNav
          onBack={() => setStep(2)}
          onNext={() => setStep(4)}
          skipLabel="Skip for now"
          onSkip={() => skipStep('photo', 4)}
        />
      </>
    );
  }

  function renderGoLive() {
    return (
      <>
        <h2 class="wizard-step-heading">Ready to go live?</h2>
        <p class="wizard-step-subheading">Here's what you're adding.</p>
        <div class="auth-form">
          <table class="extraction-table">
            <tbody>
              {name && (
                <tr>
                  <td class="field-name">name</td>
                  <td>{name}</td>
                </tr>
              )}
              {category && category !== 'other' && (
                <tr>
                  <td class="field-name">category</td>
                  <td>{categoryEmoji[category]} {category.replace(/-/g, ' ')}</td>
                </tr>
              )}
              {vibe && (
                <tr>
                  <td class="field-name">vibe</td>
                  <td>{vibe}</td>
                </tr>
              )}
              {address && (
                <tr>
                  <td class="field-name">address</td>
                  <td>{address}</td>
                </tr>
              )}
              {(lat !== 0 || lng !== 0) && (
                <tr>
                  <td class="field-name">location</td>
                  <td>{lat.toFixed(6)}, {lng.toFixed(6)}</td>
                </tr>
              )}
              {website && (
                <tr>
                  <td class="field-name">website</td>
                  <td>{website}</td>
                </tr>
              )}
              {phone && (
                <tr>
                  <td class="field-name">phone</td>
                  <td>{phone}</td>
                </tr>
              )}
              {photoKey && (
                <tr>
                  <td class="field-name">photo</td>
                  <td>uploaded</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {userRole === 'guest' && guestLabel && <p class="editor-guest-label">{guestLabel}</p>}
        {showLicenseNotice && (
          <p class="editor-license-notice">
            Your contribution will be shared under{' '}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>.
            {' '}<a href="https://whereto.bike/about/licensing/" target="_blank" rel="noopener">What does this mean?</a>
          </p>
        )}
        {editor.error && <div class="auth-error">{editor.error}</div>}
        <WizardNav
          onBack={() => setStep(3)}
          onNext={editor.save}
          nextLabel={editor.saving ? 'Saving...' : 'Save'}
          nextDisabled={editor.saving}
        />
      </>
    );
  }

  const stepRenderers = [renderWelcome, renderFind, renderDescribe, renderPhoto, renderGoLive];

  return (
    <div ref={editor.hydratedRef}>
      <WizardLayout stops={STOPS} currentStep={step} onStepChange={setStep}>
        {stepRenderers[step]()}
      </WizardLayout>
    </div>
  );
}
