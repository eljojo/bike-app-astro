import { useState, useRef, useEffect, useCallback } from 'preact/hooks';
import { throttle } from '../../lib/throttle';
import { getStyleUrl, loadStylePreference } from '../../lib/maps/map-style-switch';

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onCoordinatesChange?: (lat: number, lng: number) => void;
  cityCenter: [number, number]; // [lat, lng]
  /** Viewbox hint for Nominatim (not a hard boundary) */
  cityBounds?: { north: number; south: number; east: number; west: number };
  /** City name appended to search queries (e.g. 'Ottawa') */
  cityName?: string;
  /** ISO country code (e.g. 'ca') to restrict results */
  countryCode?: string;
  placeholder?: string;
  id?: string;
}

export default function LocationField({
  value,
  onChange,
  onCoordinatesChange,
  cityCenter,
  cityBounds,
  cityName,
  countryCode,
  placeholder = 'Address or landmark',
  id = 'location-field',
}: Props) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<import('maplibre-gl').Map | null>(null);
  const markerRef = useRef<import('maplibre-gl').Marker | null>(null);
  const createMarkerRef = useRef<((lat: number, lng: number) => import('maplibre-gl').Marker) | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync external value changes
  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Throttled Nominatim search (1100ms between actual API calls)
  const searchNominatim = useRef(throttle(async (q: string) => {
    if (!q.trim() || q.trim().length < 3) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    try {
      const fullQuery = cityName ? `${q}, ${cityName}` : q;
      const params = new URLSearchParams({
        q: fullQuery, format: 'json', addressdetails: '1', limit: '5',
        ...(countryCode ? { countrycodes: countryCode } : {}),
        ...(cityBounds ? { viewbox: `${cityBounds.west},${cityBounds.north},${cityBounds.east},${cityBounds.south}`, bounded: '0' } : {}),
      });
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?${params}`,
        { headers: { 'User-Agent': 'WheretoBike/1.0' } },
      );
      if (!res.ok) return;
      const data: NominatimResult[] = await res.json();
      setResults(data);
      setShowDropdown(data.length > 0);
      setActiveIndex(-1);
    } catch {
      // Geocoding is best-effort
    }
  }, 1100));

  // Debounce input then trigger throttled search
  const handleInput = useCallback((e: Event) => {
    const val = (e.target as HTMLInputElement).value;
    setQuery(val);
    onChange(val);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      searchNominatim.current(val);
    }, 300);
  }, [onChange]);

  // Select a result from the dropdown
  function selectResult(result: NominatimResult) {
    const displayName = result.display_name;
    setQuery(displayName);
    onChange(displayName);
    setShowDropdown(false);
    setResults([]);

    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    onCoordinatesChange?.(lat, lng);

    // Update map
    if (mapInstanceRef.current) {
      mapInstanceRef.current.flyTo({ center: [lng, lat], zoom: 15 });
      updateMarker(lat, lng);
    }
  }

  function updateMarker(lat: number, lng: number) {
    if (!mapInstanceRef.current) return;

    if (markerRef.current) {
      markerRef.current.setLngLat([lng, lat]);
    } else if (createMarkerRef.current) {
      markerRef.current = createMarkerRef.current(lat, lng);
    }
  }

  // Keyboard navigation in dropdown
  function handleKeyDown(e: KeyboardEvent) {
    if (!showDropdown || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      selectResult(results[activeIndex]);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    import('maplibre-gl').then(async (maplibregl) => {
      const { initMap } = await import('../../lib/maps/map-init');

      const map = initMap({
        el: mapContainerRef.current!,
        center: cityCenter,
        zoom: 11,
        styleUrl: getStyleUrl(loadStylePreference()),
        interactive: false,
        showAttribution: false,
      });

      createMarkerRef.current = (lat: number, lng: number) => {
        const el = document.createElement('div');
        el.className = 'location-field-marker';
        return new maplibregl.default.Marker({ element: el })
          .setLngLat([lng, lat])
          .addTo(map);
      };

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
    <div class="location-field" ref={wrapperRef}>
      <div class="location-field-input-wrap">
        <input
          id={id}
          type="text"
          value={query}
          placeholder={placeholder}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (results.length > 0) setShowDropdown(true); }}
          autocomplete="off"
        />
        {showDropdown && results.length > 0 && (
          <ul class="location-field-dropdown" role="listbox">
            {results.map((result, i) => (
              <li
                key={`${result.lat}-${result.lon}`}
                role="option"
                aria-selected={i === activeIndex}
                class={`location-field-option${i === activeIndex ? ' location-field-option--active' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); selectResult(result); }}
                onMouseEnter={() => setActiveIndex(i)}
              >
                {result.display_name}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div class="location-field-map" ref={mapContainerRef} />
    </div>
  );
}
