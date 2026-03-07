import { useState, useRef } from 'preact/hooks';
import RouteEditor from './RouteEditor';
import type { MediaItem } from './MediaManager';
import type { VariantItem } from './VariantManager';
import { slugify } from '../../lib/slug';

export default function RouteCreator() {
  const [phase, setPhase] = useState<'upload' | 'edit'>('upload');
  const [gpxContent, setGpxContent] = useState('');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [showRwgps, setShowRwgps] = useState(false);
  const [rwgpsUrl, setRwgpsUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleGpxFile(file: File) {
    setError('');
    if (!file.name.endsWith('.gpx')) {
      setError('Please upload a .gpx file');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      setGpxContent(content);

      // Extract name from filename
      const baseName = file.name.replace(/\.gpx$/i, '')
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
      setName(baseName);
      setSlug(slugify(baseName));
    };
    reader.onerror = () => setError('Failed to read GPX file');
    reader.readAsText(file);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.[0]) {
      handleGpxFile(e.dataTransfer.files[0]);
    }
  }

  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files?.[0]) {
      handleGpxFile(input.files[0]);
      input.value = '';
    }
  }

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
      setGpxContent(gpxContent);

      // Extract name from RWGPS URL
      const routeId = rwgpsUrl.match(/routes\/(\d+)/)?.[1] || 'imported';
      setName(`RWGPS ${routeId}`);
      setSlug(slugify(`rwgps-${routeId}`));
      setRwgpsUrl('');
      setShowRwgps(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  function startEditing() {
    if (!slug || !gpxContent) return;
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) {
      setError('Slug must be lowercase letters, numbers, and hyphens (no leading/trailing hyphens)');
      return;
    }
    setPhase('edit');
  }

  if (phase === 'upload') {
    return (
      <div class="route-creator">
        {!gpxContent ? (
          <>
            <div
              class={`drop-zone drop-zone--large ${dragOver ? 'drop-zone--active' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              Drop a GPX file here to start a new route
              <input
                ref={fileInputRef}
                type="file"
                accept=".gpx"
                style="display:none"
                onChange={handleFileSelect}
              />
            </div>
            {!showRwgps ? (
              <button type="button" class="btn-link-muted" onClick={() => setShowRwgps(true)}>
                or import from Ride with GPS
              </button>
            ) : (
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
          </>
        ) : (
          <div class="route-creator-setup">
            <div class="form-field">
              <label for="new-route-name">Route Name</label>
              <input
                id="new-route-name"
                type="text"
                value={name}
                onInput={(e) => {
                  const val = (e.target as HTMLInputElement).value;
                  setName(val);
                  setSlug(slugify(val));
                }}
              />
            </div>
            <div class="form-field">
              <label for="new-route-slug">Slug (URL path)</label>
              <input
                id="new-route-slug"
                type="text"
                value={slug}
                onInput={(e) => setSlug((e.target as HTMLInputElement).value)}
              />
              <small>Will be at: /routes/{slug}</small>
            </div>
            <button type="button" class="btn-primary" onClick={startEditing}>
              Create Route
            </button>
          </div>
        )}
        {error && <div class="auth-error">{error}</div>}
      </div>
    );
  }

  // Phase 2: Full editor with pre-filled data
  const initialData = {
    slug,
    name,
    tagline: '',
    tags: [] as string[],
    distance: 0,
    status: 'draft',
    body: '',
    media: [] as MediaItem[],
    variants: [{
      name,
      gpx: 'main.gpx',
      isNew: true,
      gpxContent,
    }] as VariantItem[],
    translations: {} as Record<string, { name?: string; tagline?: string; body?: string }>,
    isNew: true,
  };

  return <RouteEditor initialData={initialData} cdnUrl="" />;
}
