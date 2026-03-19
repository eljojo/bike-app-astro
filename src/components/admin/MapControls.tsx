import { useState, useEffect } from 'preact/hooks';
import { loadStylePreference, saveStylePreference, type MapStyleKey } from '../../lib/maps/map-style-switch';

interface Props {
  onTogglePhotos?: (visible: boolean) => void;
  onTogglePlaces?: (visible: boolean) => void;
  onToggleGps?: (visible: boolean) => void;
  onToggleStyle?: (key: MapStyleKey) => void;
  hasPhotos?: boolean;
  hasPlaces?: boolean;
  defaultPhotos?: boolean;
}

export function loadToggleState(key: string, defaultValue: boolean): boolean {
  if (typeof localStorage === 'undefined') return defaultValue;
  const stored = localStorage.getItem(key);
  if (stored === null) return defaultValue;
  return stored === 'true';
}

export function saveToggleState(key: string, value: boolean): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(key, String(value));
}

export default function MapControls({ onTogglePhotos, onTogglePlaces, onToggleGps, onToggleStyle, hasPhotos = true, hasPlaces = true, defaultPhotos = true }: Props) {
  const [photos, setPhotos] = useState(defaultPhotos);
  const [places, setPlaces] = useState(true);
  const [gps, setGps] = useState(false);
  const [styleKey, setStyleKey] = useState<MapStyleKey>('default');

  useEffect(() => {
    const p = loadToggleState('map-photos', defaultPhotos);
    const pl = loadToggleState('map-places', true);
    setPhotos(p);
    setPlaces(pl);
    onTogglePhotos?.(p);
    onTogglePlaces?.(pl);

    const sk = loadStylePreference();
    setStyleKey(sk);
    if (sk !== 'default') {
      onToggleStyle?.(sk);
    }
  }, []);

  function toggle(which: 'photos' | 'places' | 'gps') {
    if (which === 'photos') {
      const next = !photos;
      setPhotos(next);
      saveToggleState('map-photos', next);
      onTogglePhotos?.(next);
    } else if (which === 'places') {
      const next = !places;
      setPlaces(next);
      saveToggleState('map-places', next);
      onTogglePlaces?.(next);
    } else {
      const next = !gps;
      setGps(next);
      onToggleGps?.(next);
    }
  }

  return (
    <div class="map-controls">
      {hasPhotos && (
        <button
          class={`map-control-btn ${photos ? 'active' : ''}`}
          onClick={() => toggle('photos')}
          title={photos ? 'Hide photos' : 'Show photos'}
          aria-pressed={photos}
        >
          {'📷'}
        </button>
      )}
      {hasPlaces && (
        <button
          class={`map-control-btn ${places ? 'active' : ''}`}
          onClick={() => toggle('places')}
          title={places ? 'Hide places' : 'Show places'}
          aria-pressed={places}
        >
          {'📍'}
        </button>
      )}
      <button
        class={`map-control-btn ${gps ? 'active' : ''}`}
        onClick={() => toggle('gps')}
        title={gps ? 'Hide my location' : 'Show my location'}
        aria-pressed={gps}
      >
        {'🧭'}
      </button>
      <button
        class={`map-control-btn ${styleKey === 'high-contrast' ? 'active' : ''}`}
        onClick={() => {
          const next: MapStyleKey = styleKey === 'high-contrast' ? 'default' : 'high-contrast';
          setStyleKey(next);
          saveStylePreference(next);
          onToggleStyle?.(next);
        }}
        title={styleKey === 'high-contrast' ? 'Color map' : 'High contrast map'}
        aria-pressed={styleKey === 'high-contrast'}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a10 10 0 0 1 0 20z" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}
