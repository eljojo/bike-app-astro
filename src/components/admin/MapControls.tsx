import { useState, useEffect } from 'preact/hooks';
import Icon from '../Icon';
import { loadStylePreference, saveStylePreference, type MapStyleKey } from '../../lib/maps/map-style-switch';

interface Props {
  onTogglePhotos?: (visible: boolean) => void;
  onTogglePlaces?: (visible: boolean) => void;
  onToggleGps?: (visible: boolean) => void;
  onToggleMtb?: (visible: boolean) => void;
  onToggleStyle?: (key: MapStyleKey) => void;
  hasPhotos?: boolean;
  hasPlaces?: boolean;
  hasMtbToggle?: boolean;
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

export default function MapControls({ onTogglePhotos, onTogglePlaces, onToggleGps, onToggleMtb, onToggleStyle, hasPhotos = true, hasPlaces = true, hasMtbToggle = false, defaultPhotos = true }: Props) {
  const [photos, setPhotos] = useState(defaultPhotos);
  const [places, setPlaces] = useState(true);
  const [gps, setGps] = useState(false);
  const [mtb, setMtb] = useState(true);
  const [styleKey, setStyleKey] = useState<MapStyleKey>('default');

  useEffect(() => {
    const p = loadToggleState('map-photos', defaultPhotos);
    const pl = loadToggleState('map-places', false);
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

  function toggle(which: 'photos' | 'places' | 'gps' | 'mtb') {
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
    } else if (which === 'mtb') {
      const next = !mtb;
      setMtb(next);
      saveToggleState('map-mtb', next);
      onToggleMtb?.(next);
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
          <Icon name="camera" weight="fill" size={20} />
        </button>
      )}
      {hasPlaces && (
        <button
          class={`map-control-btn ${places ? 'active' : ''}`}
          onClick={() => toggle('places')}
          title={places ? 'Hide places' : 'Show places'}
          aria-pressed={places}
        >
          <Icon name="map-pin" weight="fill" size={20} />
        </button>
      )}
      {hasMtbToggle && (
        <button
          class={`map-control-btn ${mtb ? 'active' : ''}`}
          onClick={() => toggle('mtb')}
          title={mtb ? 'Hide MTB trails' : 'Show MTB trails'}
          aria-pressed={mtb}
        >
          <Icon name="mountains" size={20} />
        </button>
      )}
      <button
        class={`map-control-btn ${gps ? 'active' : ''}`}
        onClick={() => toggle('gps')}
        title={gps ? 'Hide my location' : 'Show my location'}
        aria-pressed={gps}
      >
        <Icon name="crosshair" size={20} />
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
        <Icon name="circle-half" size={20} />
      </button>
    </div>
  );
}
