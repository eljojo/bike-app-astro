import { useState, useRef } from 'preact/hooks';
import { useDragReorder } from '../../lib/hooks';

export interface VariantItem {
  name: string;
  gpx: string;
  distance_km?: number;
  strava_url?: string;
  rwgps_url?: string;
  isNew?: boolean;      // client-only: marks newly uploaded variants
  gpxContent?: string;  // client-only: raw GPX XML for new uploads
}

interface Props {
  variants: VariantItem[];
  onChange: (variants: VariantItem[]) => void;
}

export default function VariantManager({ variants, onChange }: Props) {
  const drag = useDragReorder(variants, onChange);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  function updateVariant(idx: number, updates: Partial<VariantItem>) {
    const updated = variants.map((v, i) => i === idx ? { ...v, ...updates } : v);
    onChange(updated);
  }

  function removeVariant(idx: number) {
    onChange(variants.filter((_, i) => i !== idx));
  }

  function handleGpxUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files?.length) return;

    setError('');
    const reader = new FileReader();
    const file = files[0];

    reader.onload = () => {
      const content = reader.result as string;
      // Derive name from filename: "richmond-loop.gpx" → "Richmond Loop"
      const baseName = file.name.replace(/\.gpx$/i, '')
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());

      const gpxFileName = variants.length === 0
        ? 'main.gpx'
        : `variants/${file.name.toLowerCase().replace(/[^a-z0-9.-]/g, '-')}`;

      onChange([...variants, {
        name: baseName,
        gpx: gpxFileName,
        isNew: true,
        gpxContent: content,
      }]);
    };

    reader.onerror = () => setError('Failed to read GPX file');
    reader.readAsText(file);
    input.value = '';
  }

  return (
    <div class="variant-manager">
      {variants.map((v, idx) => (
        <div
          key={`${v.gpx}-${idx}`}
          class={`variant-card ${drag.dragIdx === idx ? 'variant-card--dragging' : ''}`}
          draggable
          onDragStart={() => drag.handleDragStart(idx)}
          onDragOver={(e: DragEvent) => drag.handleDragOver(e, idx)}
          onDragEnd={drag.handleDragEnd}
        >
          <div class="variant-header">
            <span class="variant-grip">{'⠿'}</span>
            <strong class="variant-name">{v.name}</strong>
            {v.distance_km && <span class="variant-distance">{v.distance_km} km</span>}
            {v.isNew && <span class="variant-new">new</span>}
            <div class="variant-actions">
              <button type="button" class="btn-edit-variant" onClick={() => setEditIdx(editIdx === idx ? null : idx)}>
                {editIdx === idx ? 'Done' : 'Edit'}
              </button>
              <button type="button" class="btn-remove" onClick={() => removeVariant(idx)} title="Remove variant">
                {'×'}
              </button>
            </div>
          </div>

          {editIdx === idx && (
            <div class="variant-edit-form">
              <div class="form-field">
                <label>Name</label>
                <input
                  type="text"
                  value={v.name}
                  onInput={(e) => updateVariant(idx, { name: (e.target as HTMLInputElement).value })}
                />
              </div>
              <div class="form-field">
                <label>Strava URL</label>
                <input
                  type="url"
                  value={v.strava_url || ''}
                  onInput={(e) => updateVariant(idx, { strava_url: (e.target as HTMLInputElement).value || undefined })}
                />
              </div>
              <div class="form-field">
                <label>RideWithGPS URL</label>
                <input
                  type="url"
                  value={v.rwgps_url || ''}
                  onInput={(e) => updateVariant(idx, { rwgps_url: (e.target as HTMLInputElement).value || undefined })}
                />
              </div>
              <div class="form-field">
                <label>GPX file: <code>{v.gpx}</code></label>
              </div>
            </div>
          )}
        </div>
      ))}

      <div class="variant-add">
        <button type="button" class="btn-secondary" onClick={() => fileInputRef.current?.click()}>
          + Add variant (upload GPX)
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".gpx"
          style="display:none"
          onChange={handleGpxUpload}
        />
      </div>

      {error && <div class="auth-error">{error}</div>}
    </div>
  );
}
