import { useState, useRef, useEffect } from 'preact/hooks';
import { useDragReorder } from '../../lib/hooks';
import { extractRwgpsUrl } from '../../lib/gpx';

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
  pendingFiles?: File[];
  onPendingProcessed?: () => void;
}

export default function VariantManager({ variants, onChange, pendingFiles, onPendingProcessed }: Props) {
  const drag = useDragReorder(variants, onChange);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showRwgps, setShowRwgps] = useState(false);
  const [rwgpsUrl, setRwgpsUrl] = useState('');
  const [importing, setImporting] = useState(false);

  function updateVariant(idx: number, updates: Partial<VariantItem>) {
    const updated = variants.map((v, i) => i === idx ? { ...v, ...updates } : v);
    onChange(updated);
  }

  function removeVariant(idx: number) {
    onChange(variants.filter((_, i) => i !== idx));
  }

  function processGpxFile(file: File) {
    setError('');
    const reader = new FileReader();

    reader.onload = () => {
      const content = reader.result as string;
      // Derive name from filename: "richmond-loop.gpx" → "Richmond Loop"
      const baseName = file.name.replace(/\.gpx$/i, '')
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());

      const gpxFileName = variants.length === 0
        ? 'main.gpx'
        : `variants/${file.name.toLowerCase().replace(/[^a-z0-9.-]/g, '-')}`;

      // Auto-detect RWGPS URL from GPX metadata
      const detectedRwgpsUrl = extractRwgpsUrl(content);

      onChange([...variants, {
        name: baseName,
        gpx: gpxFileName,
        isNew: true,
        gpxContent: content,
        ...(detectedRwgpsUrl && { rwgps_url: detectedRwgpsUrl }),
      }]);
    };

    reader.onerror = () => setError('Failed to read GPX file');
    reader.readAsText(file);
  }

  function handleGpxUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files?.length) {
      processGpxFile(input.files[0]);
      input.value = '';
    }
  }

  useEffect(() => {
    if (pendingFiles && pendingFiles.length > 0) {
      for (const file of pendingFiles) {
        processGpxFile(file);
      }
      onPendingProcessed?.();
    }
  }, [pendingFiles]);

  async function handleRwgpsImport() {
    if (!rwgpsUrl.trim()) return;
    setError('');
    setImporting(true);

    try {
      const res = await fetch('/api/gpx/import-rwgps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: rwgpsUrl }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Import failed');
      }

      const { gpxContent, rwgpsUrl: resolvedUrl } = await res.json();

      // Derive variant name from RWGPS URL
      const routeId = rwgpsUrl.match(/routes\/(\d+)/)?.[1] || 'imported';
      const gpxFileName = variants.length === 0
        ? 'main.gpx'
        : `variants/rwgps-${routeId}.gpx`;

      onChange([...variants, {
        name: `RWGPS ${routeId}`,
        gpx: gpxFileName,
        isNew: true,
        gpxContent,
        rwgps_url: resolvedUrl,
      }]);

      setRwgpsUrl('');
      setShowRwgps(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
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
        <div class="variant-add-buttons">
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
          {!showRwgps && (
            <button type="button" class="btn-secondary" onClick={() => setShowRwgps(true)}>
              + Add variant (Ride with GPS)
            </button>
          )}
        </div>
        {showRwgps && (
          <div class="rwgps-import">
            <input
              type="url"
              class="rwgps-input"
              placeholder="https://ridewithgps.com/routes/..."
              value={rwgpsUrl}
              onInput={(e) => setRwgpsUrl((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleRwgpsImport(); } }}
            />
            <button
              type="button"
              class="btn-secondary"
              onClick={handleRwgpsImport}
              disabled={importing || !rwgpsUrl.trim()}
            >
              {importing ? 'Importing...' : 'Import'}
            </button>
            <button type="button" class="btn-cancel" onClick={() => { setShowRwgps(false); setRwgpsUrl(''); }}>
              Cancel
            </button>
          </div>
        )}
      </div>

      {error && <div class="auth-error">{error}</div>}
    </div>
  );
}
