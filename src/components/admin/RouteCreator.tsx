import { useState, useRef, useMemo } from 'preact/hooks';
import RouteEditor from './RouteEditor';
import StaticRouteMap from './StaticRouteMap';
import type { MediaItem } from './MediaManager';
import type { VariantItem } from './VariantManager';
import { slugify } from '../../lib/slug';
import { parseGpx } from '../../lib/gpx/parse';
import { computeElevationProfile, CHART } from '../../lib/geo/elevation-profile';
import { buildMediaThumbnailUrl } from '../../lib/media/image-service';
import type { MediaThumbnailConfig } from '../../lib/media/image-service';
import { findNearbyMedia } from '../../lib/geo/media-proximity';

interface Props {
  cdnUrl: string;
  videosCdnUrl?: string;
  videoPrefix?: string;
  mediaLocations?: Array<{ key: string; lat: number; lng: number; routeSlug: string; caption?: string; width?: number; height?: number; type?: 'photo' | 'video' }>;
}

export default function RouteCreator({ cdnUrl, videosCdnUrl, videoPrefix, mediaLocations = [] }: Props) {
  const thumbConfig: MediaThumbnailConfig = { cdnUrl, videosCdnUrl, videoPrefix };
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

  const track = useMemo(() => gpxContent ? parseGpx(gpxContent) : null, [gpxContent]);

  const elevation = useMemo(
    () => track ? computeElevationProfile(track.points, track.distance_m) : null,
    [track],
  );

  const coordinates = useMemo(
    () => track ? track.points.map(p => [p.lon, p.lat] as [number, number]) : [],
    [track],
  );

  const nearbyPhotos = useMemo(() => {
    if (!track || track.points.length === 0) return [];
    const step = Math.max(1, Math.floor(track.points.length / 50));
    const sampled = track.points.filter((_, i) => i % step === 0);
    const trackPts = sampled.map(p => ({ lat: p.lat, lng: p.lon }));
    return findNearbyMedia(trackPts, mediaLocations, '');
  }, [track]);

  function slugToName(slug: string): string {
    return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

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
          <div class="route-creator-prompt">
            <div
              class={`drop-zone drop-zone--hero ${dragOver ? 'drop-zone--active' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <svg class="drop-zone-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span class="drop-zone-label">Drop a GPX file here</span>
              <span class="drop-zone-hint">or click to choose a file</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".gpx"
                style="display:none"
                onChange={handleFileSelect}
              />
            </div>
            <div class="creator-divider"><span>or</span></div>
            <div class="url-import">
              <input
                type="url"
                class="url-import-input"
                placeholder="Paste a RideWithGPS or Google Maps link"
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
            <a href="https://whereto.bike/guides/gpx-files/" target="_blank" rel="noopener noreferrer" class="route-creator-help-link">
              What's a GPX file?
            </a>
          </div>
        ) : (
          <div class="route-creator-setup">
            <div class="route-preview-actions">
              <div class="form-field">
                <label for="new-route-name">Name your route</label>
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
              <button type="button" class="btn-primary" onClick={startEditing}>
                Continue
              </button>
            </div>

            <div class="route-preview">
              <StaticRouteMap coordinates={coordinates} class="route-preview-map" />

              {track && (
                <div class="route-preview-stats">
                  <span>{(track.distance_m / 1000).toFixed(1)} km</span>
                  <span>{track.elevation_gain_m}m gain</span>
                  <span>{track.max_gradient_pct}% max grade</span>
                </div>
              )}

              {elevation && (() => {
                const plotBottom = CHART.height - CHART.bottom;
                const plotLeft = CHART.left;
                const plotRight = CHART.width - CHART.right;
                return (
                  <div class="route-preview-elevation">
                    <svg viewBox={`0 0 ${CHART.width} ${CHART.height}`} class="route-preview-elevation-svg">
                      {elevation.yTicks.map(tick => (
                        <line x1={plotLeft} x2={plotRight} y1={tick.position} y2={tick.position}
                              stroke="var(--elevation-grid)" stroke-width="0.5" />
                      ))}
                      <path d={elevation.svgArea} fill="var(--elevation-fill)" />
                      <path d={elevation.svgPath} fill="none" stroke="var(--elevation-line)" stroke-width="2" />
                      {elevation.yTicks.map(tick => (
                        <text x={plotLeft - 5} y={tick.position + 4} text-anchor="end"
                              font-size="11" fill="var(--elevation-text)">{tick.label}</text>
                      ))}
                      {elevation.xTicks.map(tick => (
                        <text x={tick.position} y={plotBottom + 16} text-anchor="middle"
                              font-size="11" fill="var(--elevation-text)">{tick.label}</text>
                      ))}
                      <text x={plotRight} y={plotBottom + 16} text-anchor="middle"
                            font-size="11" fill="var(--elevation-text)">km</text>
                    </svg>
                  </div>
                );
              })()}

              {nearbyPhotos.length > 0 && (() => {
                const routeSlugs = [...new Set(nearbyPhotos.map(p => p.routeSlug))];
                const routeNames = routeSlugs.filter(s => s !== '__parked').slice(0, 3).map(slugToName);
                const label = routeNames.length > 0
                  ? `${nearbyPhotos.length} photos nearby · ${routeNames.join(', ')}`
                  : `${nearbyPhotos.length} photos nearby`;
                return (
                  <div class="route-preview-photos">
                    <small>{label}</small>
                    <div class="route-preview-photos-strip">
                      {nearbyPhotos.slice(0, 12).map(photo => (
                        <img
                          key={photo.key}
                          src={buildMediaThumbnailUrl(photo, thumbConfig, { width: 120, height: 120, fit: 'cover' })}
                          alt={photo.caption || ''}
                          loading="lazy"
                        />
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
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

  return <RouteEditor initialData={initialData} cdnUrl={cdnUrl} />;
}
