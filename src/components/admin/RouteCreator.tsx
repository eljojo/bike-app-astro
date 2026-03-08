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
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [sourceUrl, setSourceUrl] = useState('');
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

  async function handleUrlImport() {
    if (!importUrl.trim()) return;
    setError('');
    setImporting(true);

    try {
      const res = await fetch('/api/gpx/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: importUrl }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Import failed');
      }

      const { gpxContent: content, name: routeName, sourceUrl: resolvedUrl } = await res.json();
      setGpxContent(content);
      setName(routeName);
      setSlug(slugify(routeName));
      setSourceUrl(resolvedUrl);
      setImportUrl('');
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
            <div class="url-import">
              <input
                type="url"
                class="url-import-input"
                placeholder="or paste a URL (RideWithGPS, Google Maps)"
                value={importUrl}
                onInput={(e) => setImportUrl((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleUrlImport(); } }}
              />
              {importUrl.trim() && (
                <button
                  type="button"
                  class="btn-secondary"
                  onClick={handleUrlImport}
                  disabled={importing}
                >
                  {importing ? 'Importing...' : 'Import'}
                </button>
              )}
            </div>
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
      ...(sourceUrl.includes('ridewithgps.com') && { rwgps_url: sourceUrl }),
      ...(sourceUrl.includes('google.com/maps/d/') && { google_maps_url: sourceUrl }),
    }] as VariantItem[],
    translations: {} as Record<string, { name?: string; tagline?: string; body?: string }>,
    isNew: true,
  };

  return <RouteEditor initialData={initialData} cdnUrl="" />;
}
