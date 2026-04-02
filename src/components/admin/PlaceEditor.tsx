// AGENTS.md: See src/components/admin/AGENTS.md for editor rules.
// Key: textarea hydration workaround required, contentHash must sync after save, all styles in admin.scss.
import { useState, useRef, useEffect, useMemo } from 'preact/hooks';
import { useEditorForm } from './useEditorForm';
import EditorLayout from './EditorLayout';
import { bindText } from './field-helpers';
import { useFormValidation } from './useFormValidation';
import PhotoField from './PhotoField';
import PlacePreview from './PlacePreview';
import { categoryEmoji } from '../../lib/geo/place-categories';
import { goodForEnum } from '../../schemas/index';
import { buildMediaThumbnailUrl } from '../../lib/media/image-service';
import type { MediaThumbnailConfig } from '../../lib/media/image-service';
import { getStyleUrl, loadStylePreference } from '../../lib/maps/map-style-switch';
import polyline from '@mapbox/polyline';
import { haversineM, PHOTO_NEAR_PLACE_M } from '../../lib/geo/proximity';
import type { PlaceDetail } from '../../lib/models/place-model';
import type { PlaceUpdate } from '../../views/api/place-save';
import { localeLabel } from '../../lib/i18n/locale-utils';

const SOCIAL_PLATFORMS = [
  'instagram', 'facebook', 'strava', 'youtube',
  'meetup', 'tiktok', 'bluesky', 'threads', 'website',
  'discord', 'google_form', 'linktree', 'rwgps', 'komoot', 'newsletter', 'mastodon',
  'booking', 'telephone', 'email',
] as const;

interface SocialLink {
  platform: string;
  url: string;
}

interface Props {
  initialData: PlaceDetail & { contentHash?: string; isNew?: boolean };
  cdnUrl: string;
  videosCdnUrl?: string;
  videoPrefix?: string;
  userRole?: string;
  secondaryLocales?: string[];
  mapCenter?: [number, number]; // [lat, lng] — city default center for new places
  nearRouteSlug?: string;
  detailsToggleLabel?: string;
  mediaLocations?: Array<{ key: string; lat: number; lng: number; routeSlug: string; caption?: string; width?: number; height?: number; type?: 'photo' | 'video' }>;
  guestLabel?: string;
  organizers?: Array<{ slug: string; name: string }>;
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

export default function PlaceEditor({ initialData, cdnUrl, videosCdnUrl, videoPrefix, userRole, secondaryLocales, mapCenter, nearRouteSlug, detailsToggleLabel, mediaLocations = [], guestLabel, organizers }: Props) {
  const thumbConfig: MediaThumbnailConfig = { cdnUrl, videosCdnUrl, videoPrefix };

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
  const [vibe, setVibe] = useState(initialData.vibe || '');
  const [goodFor, setGoodFor] = useState<string[]>(initialData.good_for || []);
  const [organizer, setOrganizer] = useState(initialData.organizer || '');
  const [socialLinks, setSocialLinks] = useState<SocialLink[]>(
    initialData.social_links?.length ? initialData.social_links : [],
  );
  const [prefilling, setPrefilling] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(!initialData.isNew);

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

  const editor = useEditorForm({
    apiBase: '/api/places',
    contentId: initialData.isNew ? null : initialData.id,
    contentHash: initialData.contentHash,
    userRole,
    validate,
    deps: [name, translations, category, lat, lng, address, website, phone, googleMapsUrl, photoKey, vibe, goodFor, organizer, socialLinks],
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
          ...(vibe && { vibe }),
          good_for: goodFor,
          ...(address && { address }),
          ...(website && { website }),
          ...(phone && { phone }),
          ...(googleMapsUrl && { google_maps_url: googleMapsUrl }),
          ...(photoKey && { photo_key: photoKey }),
          ...(organizer && { organizer }),
          social_links: socialLinks.filter(l => l.url.trim()),
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
    return mediaLocations
      .filter((p) => haversineM(lat, lng, p.lat, p.lng) <= PHOTO_NEAR_PLACE_M)
      .sort((a, b) => haversineM(lat, lng, a.lat, a.lng) - haversineM(lat, lng, b.lat, b.lng))
      .slice(0, 12);
  }, [lat, lng]);

  async function handlePrefill() {
    const query = googleMapsUrl.trim();
    if (!query || query === lastPrefillQuery.current) return;
    lastPrefillQuery.current = query;
    setPrefilling(true);
    editor.setError('');
    try {
      const res = await fetch('/api/places/prefill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      if (!res.ok) {
        editor.setError(data.error || 'Prefill failed');
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

  function addSocialLink() {
    setSocialLinks(prev => [...prev, { platform: 'instagram', url: '' }]);
  }

  function removeSocialLink(index: number) {
    setSocialLinks(prev => prev.filter((_, i) => i !== index));
  }

  function updateSocialLink(index: number, field: 'platform' | 'url', value: string) {
    setSocialLinks(prev => prev.map((link, i) =>
      i === index ? { ...link, [field]: value } : link,
    ));
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

  // Draw reference route polyline when creating a place near a route
  useEffect(() => {
    if (!nearRouteSlug) return;

    fetch(`/routes/${nearRouteSlug}.json`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!data || !mapInstanceRef.current) return;
        const variant = data.variants?.[0];
        if (!variant?.polyline) return;

        const decoded = polyline.decode(variant.polyline);
        const geojson = {
          type: 'Feature' as const,
          geometry: {
            type: 'LineString' as const,
            coordinates: decoded.map(([lat, lng]: [number, number]) => [lng, lat]),
          },
          properties: {},
        };

        const map = mapInstanceRef.current;
        map.addSource('route-reference', { type: 'geojson', data: geojson });
        map.addLayer({
          id: 'route-reference-line',
          type: 'line',
          source: 'route-reference',
          paint: {
            'line-color': '#2563eb',
            'line-width': 3,
            'line-opacity': 0.4,
          },
        });

        if (!lat && !lng && variant.bounds) {
          map.fitBounds(
            [[variant.bounds[0][1], variant.bounds[0][0]], [variant.bounds[1][1], variant.bounds[1][0]]],
            { padding: 40 }
          );
        }
      })
      .catch(() => {});
  }, [nearRouteSlug]);

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
    <EditorLayout
      editor={editor}
      className="place-editor"
      contentType="place"
      userRole={userRole}
      guestLabel={guestLabel}
      viewLink="/admin/places"
      preview={
        <PlacePreview
          name={name}
          category={category}
          vibe={vibe}
          lat={lat}
          lng={lng}
          address={address}
          website={website}
          phone={phone}
          goodFor={goodFor}
          photoKey={photoKey}
          socialLinks={socialLinks}
          cdnUrl={cdnUrl}
        />
      }
    >
        {initialData.isNew && googleMapsField}

        <div class="form-field">
          <label for="place-name">Name</label>
          <input id="place-name" type="text" {...bindText(name, setName)} />
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
          <div ref={mapContainerRef} class="place-map-picker" />
          {(lat !== 0 || lng !== 0) && (
            <div class="place-coords">
              {lat.toFixed(6)}, {lng.toFixed(6)}
            </div>
          )}
        </div>

        {initialData.isNew && !detailsExpanded && (
          <button type="button" class="btn-secondary details-toggle"
            onClick={() => setDetailsExpanded(true)}>
            {detailsToggleLabel || 'Add details (address, website, phone)'}
          </button>
        )}

        {(detailsExpanded || !initialData.isNew) && (
          <>
            {locales.map(locale => (
              <div class="form-field" key={locale}>
                <label for={`place-name-${locale}`}>Name ({localeLabel(locale)})</label>
                <input id={`place-name-${locale}`} type="text" value={translations[locale] || ''}
                  onInput={(e) => setTranslation(locale, (e.target as HTMLInputElement).value)} />
              </div>
            ))}

            <div class="form-field">
              <label for="place-address">Address</label>
              <input id="place-address" type="text" {...bindText(address, setAddress)} />
            </div>

            <div class="form-field">
              <label for="place-website">Website</label>
              <input id="place-website" type="url" {...bindText(website, setWebsite)}
                placeholder="https://" />
            </div>

            <div class="form-field">
              <label for="place-phone">Phone</label>
              <input id="place-phone" type="tel" {...bindText(phone, setPhone)} />
            </div>

            <div class="form-field">
              <label for="place-vibe">Vibe <span class="field-hint">(one-sentence hook)</span></label>
              <input id="place-vibe" type="text" {...bindText(vibe, setVibe)}
                placeholder="What makes this place worth visiting" />
            </div>

            <div class="form-field">
              <label>Good for</label>
              <div class="good-for-options">
                {goodForEnum.options.map((value) => (
                  <label key={value} class="good-for-tag">
                    <input
                      type="checkbox"
                      checked={goodFor.includes(value)}
                      onChange={(e) => {
                        const checked = (e.target as HTMLInputElement).checked;
                        setGoodFor(prev =>
                          checked ? [...prev, value] : prev.filter(v => v !== value)
                        );
                      }}
                    />
                    {value.replace(/-/g, ' ')}
                  </label>
                ))}
              </div>
            </div>

            {organizers && organizers.length > 0 && (
              <div class="form-field">
                <label for="place-organizer">Bike Shop</label>
                <select
                  id="place-organizer"
                  value={organizer}
                  onChange={(e) => setOrganizer((e.target as HTMLSelectElement).value)}
                >
                  <option value="">None</option>
                  {organizers.map(org => (
                    <option key={org.slug} value={org.slug}>{org.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div class="form-field">
              <label>Social links</label>
              {socialLinks.map((link, index) => (
                <div class="social-link-row" key={index}>
                  <select
                    value={link.platform}
                    onChange={(e) => updateSocialLink(index, 'platform', (e.target as HTMLSelectElement).value)}
                  >
                    {SOCIAL_PLATFORMS.map(p => (
                      <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                    ))}
                  </select>
                  <input
                    type="url"
                    value={link.url}
                    placeholder="https://..."
                    onInput={(e) => updateSocialLink(index, 'url', (e.target as HTMLInputElement).value)}
                  />
                  <button type="button" class="btn-remove-social" onClick={() => removeSocialLink(index)}>
                    Remove
                  </button>
                </div>
              ))}
              <button type="button" class="btn-secondary" onClick={addSocialLink}>
                + Add social link
              </button>
            </div>

            {initialData.isNew && googleMapsField}
          </>
        )}

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
    </EditorLayout>
  );
}
