// AGENTS.md: See src/components/admin/AGENTS.md for editor rules.
// Key: textarea hydration workaround required, contentHash must sync after save, all styles in admin.scss.
import { useState, useRef, useCallback, useEffect, useMemo } from 'preact/hooks';
import MediaManager from './MediaManager';
import type { MediaItem } from './MediaManager';
import type { VariantItem } from './VariantManager';
import AutoDetectField from './AutoDetectField';
import MarkdownToolbar from './MarkdownToolbar';
import RidePreview from './RidePreview';
import { useEditorState } from './useEditorState';
import { useTextareaValue, useDragDrop } from '../../lib/hooks';
import { slugify } from '../../lib/slug';
import { extractRideDate, parseGpx } from '../../lib/gpx';
import { computeElevationProfile } from '../../lib/elevation-profile';
import type { ElevationProfileData } from '../../lib/elevation-profile';
import { insertMarkdown } from './markdown-toolbar-utils';
import TourPicker from './TourPicker';
import type { RideDetail } from '../../lib/models/ride-model';

interface TourInfo {
  slug: string;
  name: string;
  start_date?: string;
  end_date?: string;
  ride_count?: number;
}

interface StravaActivityItem {
  id: number;
  name: string;
  sport_type: string;
  distance: number;
  elapsed_time: number;
  start_date: string;
  start_date_local: string;
  map: { summary_polyline: string };
  photo_count: number;
}

interface Props {
  initialData: RideDetail & { contentHash?: string; isNew?: boolean; gpxRelativePath?: string };
  cdnUrl: string;
  userRole?: string;
  mapThumbnail?: string;
  rideLabels?: Record<string, string>;
  tours?: TourInfo[];
  stravaConnected?: boolean;
}

function formatDistance(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

export default function RideEditor({ initialData, cdnUrl, userRole, mapThumbnail, rideLabels, tours = [], stravaConnected }: Props) {
  // State
  const [name, setName] = useState(initialData.name);
  const [slug, setSlug] = useState(initialData.slug);
  const [editingSlug, setEditingSlug] = useState(false);
  const [status, setStatus] = useState(initialData.status);
  const [body, setBody] = useState(initialData.body);
  const [media, setMedia] = useState<MediaItem[]>(initialData.media as MediaItem[]);
  const [variants, setVariants] = useState<VariantItem[]>(initialData.variants || []);
  const [rideDate, setRideDate] = useState(initialData.ride_date || '');
  const [country, setCountry] = useState(initialData.country || '');
  const [tourSlug, setTourSlug] = useState(initialData.tour_slug || '');
  const [highlight, setHighlight] = useState(initialData.highlight || false);
  const [privacyZone, setPrivacyZone] = useState(initialData.privacy_zone ?? false);
  const [stravaId, setStravaId] = useState(initialData.strava_id || '');

  // Mobile tabs
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');

  // Collapsible details (collapsed by default for existing rides)
  const [detailsOpen, setDetailsOpen] = useState(!!initialData.isNew);

  // Textarea ref (hydration workaround — see AGENTS.md)
  const bodyRef = useTextareaValue(body);

  // Strava browser state
  const [stravaBrowsing, setStravaBrowsing] = useState(false);
  const [stravaActivities, setStravaActivities] = useState<StravaActivityItem[]>([]);
  const [stravaLoading, setStravaLoading] = useState(false);
  const [stravaImporting, setStravaImporting] = useState(false);
  const [stravaError, setStravaError] = useState('');
  const [stravaPage, setStravaPage] = useState(1);

  // Hydrate from Strava import stashed in sessionStorage (from rides list page)
  useEffect(() => {
    if (!initialData.isNew) return;
    const raw = sessionStorage.getItem('strava-import');
    if (!raw) return;
    sessionStorage.removeItem('strava-import');
    try {
      const result = JSON.parse(raw);
      if (result.name) setName(result.name);
      if (result.strava_id) setStravaId(result.strava_id);
      const dateStr = result.start_date_local?.split('T')[0] || result.start_date?.slice(0, 10) || '';
      if (dateStr) {
        setRideDate(dateStr);
        setSlug(slugify(`${dateStr}-${result.name}`));
      }
      if (result.gpxContent) {
        const gpxFilename = `${dateStr}-${slugify(result.name)}.gpx`;
        setVariants([{ name: result.name, gpx: gpxFilename, isNew: true, gpxContent: result.gpxContent }]);
      }
      if (result.photos?.length) {
        setMedia(result.photos.map((p: { key: string; caption: string; lat?: number; lng?: number }, i: number) => ({
          key: p.key, caption: p.caption, lat: p.lat, lng: p.lng, cover: i === 0,
        })));
      }
      setPrivacyZone(false);
    } catch { /* ignore malformed data */ }
  }, []);

  // Auto-detect country from GPX first trackpoint via Nominatim
  useEffect(() => {
    if (country) return; // Don't override existing country
    const gpx = variants[0];
    if (!gpx?.gpxContent) return;

    let cancelled = false;
    (async () => {
      try {
        const track = parseGpx(gpx.gpxContent!);
        if (!track.points.length) return;
        const { lat, lon } = track.points[0];
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=3`,
          { headers: { 'Accept-Language': 'en' } }, // eslint-disable-line bike-app/no-hardcoded-city-locale -- Nominatim API language, not a locale setting
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const code = data?.address?.country_code;
        if (code && !cancelled) setCountry(code.toUpperCase());
      } catch { /* Nominatim failures are non-critical */ }
    })();

    return () => { cancelled = true; };
  }, [variants]);

  // Drag-and-drop
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const { dragging } = useDragDrop((files) => {
    const images = files.filter(f => f.type.startsWith('image/'));
    const gpx = files.filter(f => f.name.toLowerCase().endsWith('.gpx'));
    if (images.length > 0) setPendingFiles(images);
    if (gpx.length > 0) handleGpxUpload(gpx[0]);
  });

  // GPX handling
  function handleGpxUpload(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      const detected = extractRideDate(content);
      if (detected && !rideDate) setRideDate(detected);
      setVariants([{
        name: file.name.replace(/\.gpx$/i, ''),
        gpx: file.name,
        isNew: true,
        gpxContent: content,
      }]);
    };
    reader.readAsText(file);
  }

  // Strava import
  async function openStravaBrowser() {
    setStravaBrowsing(true);
    setStravaError('');
    setStravaPage(1);
    await loadStravaActivities(1);
  }

  async function loadStravaActivities(page: number) {
    setStravaLoading(true);
    setStravaError('');
    try {
      const res = await fetch(`/api/strava/activities?page=${page}&per_page=20`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to load activities (${res.status})`);
      }
      const activities: StravaActivityItem[] = await res.json();
      setStravaActivities(activities);
      setStravaPage(page);
    } catch (err) {
      setStravaError(err instanceof Error ? err.message : 'Failed to load activities');
    } finally {
      setStravaLoading(false);
    }
  }

  async function importStravaActivity(activity: StravaActivityItem) {
    setStravaImporting(true);
    setStravaError('');
    try {
      const res = await fetch('/api/strava/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityId: activity.id,
          activityName: activity.name,
          startDate: activity.start_date,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Import failed (${res.status})`);
      }
      const result = await res.json();

      // Populate editor with imported data
      setName(result.name || activity.name);
      setStravaId(result.strava_id);
      setPrivacyZone(false); // Strava already trims

      // Set GPX variant
      const dateStr = activity.start_date_local?.split('T')[0] || '';
      const gpxFilename = `${dateStr}-${slugify(activity.name)}.gpx`;
      if (dateStr && !rideDate) setRideDate(dateStr);
      setSlug(slugify(`${dateStr}-${activity.name}`));
      setVariants([{
        name: activity.name,
        gpx: gpxFilename,
        isNew: true,
        gpxContent: result.gpxContent,
      }]);

      // Add imported photos as media
      if (result.photos?.length) {
        const importedMedia: MediaItem[] = result.photos.map((p: { key: string; caption: string; lat?: number; lng?: number }, i: number) => ({
          key: p.key,
          caption: p.caption,
          lat: p.lat,
          lng: p.lng,
          cover: i === 0,
        }));
        setMedia(importedMedia);
      }

      setStravaBrowsing(false);
    } catch (err) {
      setStravaError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setStravaImporting(false);
    }
  }

  // Keyboard shortcuts for markdown
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    const ta = bodyRef.current;
    if (!ta) return;

    let action: 'bold' | 'italic' | 'link' | null = null;
    if (e.key === 'b') action = 'bold';
    else if (e.key === 'i') action = 'italic';
    else if (e.key === 'k') action = 'link';

    if (action) {
      e.preventDefault();
      const result = insertMarkdown(ta.value, ta.selectionStart, ta.selectionEnd, action);
      setBody(result.text);
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(result.cursor, result.cursor);
      });
    }
  }, []);

  // GPX stats from variant
  const gpxVariant = variants[0];
  const distanceKm = gpxVariant?.distance_km;

  // Parse GPX for map preview + elevation
  const gpxContent = gpxVariant?.gpxContent;
  const track = useMemo(() => gpxContent ? parseGpx(gpxContent) : null, [gpxContent]);
  const elevation: ElevationProfileData | null = useMemo(
    () => track ? computeElevationProfile(track.points, track.distance_m) : null,
    [track],
  );
  const coordinates = useMemo(
    () => track ? track.points.map(p => [p.lon, p.lat] as [number, number]) : [],
    [track],
  );

  // Save
  const { saving, saved, error, githubUrl, save: handleSave } = useEditorState({
    apiBase: '/api/rides',
    contentId: initialData.isNew ? null : initialData.slug,
    initialContentHash: initialData.contentHash,
    userRole,
    validate: () => {
      if (!name.trim()) return 'Name is required';
      if (!variants.length) return 'A GPX file is required';
      return null;
    },
    buildPayload: () => ({
      frontmatter: {
        name,
        status,
        ride_date: rideDate || undefined,
        country: country || undefined,
        tour_slug: tourSlug || undefined,
        highlight: highlight || undefined,
        strava_id: stravaId || undefined,
        privacy_zone: privacyZone || undefined,
      },
      body,
      media,
      variants,
      gpxRelativePath: initialData.gpxRelativePath,
    }),
    onSuccess: (result) => {
      if (initialData.isNew && result.id) {
        window.location.href = `/admin/rides/${result.id}`;
      }
    },
  });

  // GPX file input
  const gpxInputRef = useRef<HTMLInputElement>(null);

  return (
    <div class="ride-editor">
      {dragging && (
        <div class="drop-overlay">
          <div class="drop-overlay-content">Drop photos or GPX files to add to ride</div>
        </div>
      )}

      {/* Strava activity browser modal */}
      {stravaBrowsing && (
        <div class="strava-browser-overlay" onClick={(e) => { if (e.target === e.currentTarget) setStravaBrowsing(false); }}>
          <div class="strava-browser">
            <div class="strava-browser-header">
              <h3>Import from Strava</h3>
              <button type="button" class="btn-small" onClick={() => setStravaBrowsing(false)}>Close</button>
            </div>
            {stravaError && <div class="auth-error">{stravaError}</div>}
            {stravaLoading ? (
              <div class="strava-browser-loading">Loading activities...</div>
            ) : (
              <div class="strava-activity-list">
                {stravaActivities.map((activity) => (
                  <button
                    key={activity.id}
                    type="button"
                    class="strava-activity-card"
                    onClick={() => importStravaActivity(activity)}
                    disabled={stravaImporting}
                  >
                    <div class="strava-activity-card-main">
                      <span class="strava-activity-name">{activity.name}</span>
                      <span class="strava-activity-date">{formatDate(activity.start_date_local)}</span>
                    </div>
                    <div class="strava-activity-card-meta">
                      <span>{formatDistance(activity.distance)}</span>
                      <span>{formatDuration(activity.elapsed_time)}</span>
                      <span class="strava-activity-type">{activity.sport_type}</span>
                      {activity.photo_count > 0 && <span>{activity.photo_count} photos</span>}
                    </div>
                  </button>
                ))}
                {stravaActivities.length === 0 && !stravaLoading && (
                  <div class="strava-browser-empty">No cycling activities found.</div>
                )}
              </div>
            )}
            {stravaImporting && <div class="strava-browser-loading">Importing activity...</div>}
            <div class="strava-browser-pagination">
              {stravaPage > 1 && (
                <button type="button" class="btn-small" onClick={() => loadStravaActivities(stravaPage - 1)} disabled={stravaLoading}>
                  Previous
                </button>
              )}
              {stravaActivities.length === 20 && (
                <button type="button" class="btn-small" onClick={() => loadStravaActivities(stravaPage + 1)} disabled={stravaLoading}>
                  Next
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile tabs */}
      <div class="ride-editor-tabs">
        <button
          type="button"
          class={`ride-editor-tab ${activeTab === 'edit' ? 'ride-editor-tab--active' : ''}`}
          onClick={() => setActiveTab('edit')}
        >Edit</button>
        <button
          type="button"
          class={`ride-editor-tab ${activeTab === 'preview' ? 'ride-editor-tab--active' : ''}`}
          onClick={() => setActiveTab('preview')}
        >Preview</button>
      </div>

      <div class="ride-editor-panes">
        {/* LEFT PANE: Editor */}
        <div class={`ride-editor-edit ${activeTab !== 'edit' ? 'ride-editor-pane--hidden' : ''}`}>
          {/* Title */}
          <div class="form-field">
            <label for="ride-name">Title</label>
            <input
              id="ride-name"
              type="text"
              value={name}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
              placeholder="What do you want to call this ride?"
            />
          </div>

          {/* Ride Details (collapsible) */}
          <div class={`ride-details ${detailsOpen ? 'ride-details--open' : ''}`}>
            <button type="button" class="ride-details-toggle" onClick={() => setDetailsOpen(!detailsOpen)}>
              <span class="ride-details-toggle-label">
                Details
                {!detailsOpen && (rideDate || country) && (
                  <span class="ride-details-summary">
                    {[rideDate, country].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
              <span class="ride-details-toggle-arrow">{detailsOpen ? '\u25be' : '\u25b8'}</span>
            </button>
            {detailsOpen && (
              <div class="ride-details-body">
                {/* Slug */}
                <div class="ride-detail-row">
                  <label>URL</label>
                  {editingSlug ? (
                    <div class="ride-slug-edit">
                      <span class="ride-slug-prefix">/rides/</span>
                      <input
                        type="text"
                        value={slug}
                        onInput={(e) => setSlug(slugify((e.target as HTMLInputElement).value))}
                        class="ride-slug-input"
                      />
                      <button type="button" class="btn-small" onClick={() => setEditingSlug(false)}>Done</button>
                    </div>
                  ) : (
                    <button type="button" class="ride-slug-toggle" onClick={() => setEditingSlug(true)}>
                      /rides/{slug}
                    </button>
                  )}
                </div>

                <div class="ride-detail-grid">
                  <AutoDetectField
                    label="Date"
                    value={rideDate}
                    autoDetected={!!initialData.ride_date || !!rideDate}
                    onChange={setRideDate}
                    type="date"
                  />
                  <div class="form-field">
                    <label>Country</label>
                    <input type="text" value={country} onInput={(e) => setCountry((e.target as HTMLInputElement).value)} />
                  </div>
                  <TourPicker tours={tours} value={tourSlug} onChange={setTourSlug} />
                  {userRole === 'admin' && (
                    <div class="form-field">
                      <label for="ride-status">Status</label>
                      <select id="ride-status" value={status} onChange={(e) => setStatus((e.target as HTMLSelectElement).value)}>
                        <option value="published">Published</option>
                        <option value="draft">Draft</option>
                      </select>
                    </div>
                  )}
                </div>

                <div class="form-field form-field--inline">
                  <label>
                    <input type="checkbox" checked={highlight} onChange={() => setHighlight(!highlight)} />
                    {' '}Highlight on home page
                  </label>
                </div>

                <div class="form-field form-field--inline">
                  <label>
                    <input type="checkbox" checked={privacyZone} onChange={() => setPrivacyZone(!privacyZone)} />
                    {' '}Apply privacy zone
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* GPX */}
          <fieldset class="ride-gpx">
            <legend>GPX</legend>
            {gpxVariant ? (
              <div class="ride-gpx-info">
                <span class="ride-gpx-filename">{gpxVariant.gpx}</span>
                {distanceKm != null && <span class="ride-gpx-stat">{distanceKm.toFixed(0)} km</span>}
                <div class="ride-gpx-actions">
                  {!gpxVariant.isNew && !initialData.isNew && (
                    <a
                      href={`/rides/${initialData.slug}/${gpxVariant.gpx.replace(/\.gpx$/i, '').replace(/^variants\//, '')}.gpx`}
                      download={gpxVariant.gpx.replace(/^variants\//, '')}
                      class="btn-small"
                    >Download</a>
                  )}
                  <button type="button" class="btn-small" onClick={() => gpxInputRef.current?.click()}>Replace</button>
                </div>
              </div>
            ) : (
              <div class="ride-gpx-empty">
                <button type="button" class="btn-primary" onClick={() => gpxInputRef.current?.click()}>
                  Upload GPX file
                </button>
                {stravaConnected && (
                  <button type="button" class="btn-secondary strava-import-btn" onClick={openStravaBrowser}>
                    Import from Strava
                  </button>
                )}
                <span class="ride-gpx-hint">or drag and drop</span>
              </div>
            )}
            <input
              ref={gpxInputRef}
              type="file"
              accept=".gpx"
              class="visually-hidden"
              onChange={(e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) handleGpxUpload(file);
              }}
            />
          </fieldset>

          {/* Markdown editor */}
          <div class="form-field ride-body-field">
            <label for="ride-body">Story</label>
            <MarkdownToolbar textareaRef={bodyRef} onTextChange={setBody} />
            <textarea
              ref={bodyRef}
              id="ride-body"
              value={body}
              onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
              onKeyDown={handleKeyDown}
              rows={16}
              placeholder="Write about your ride..."
            />
          </div>

          {/* Photos */}
          <section class="editor-section">
            <h2>Photos</h2>
            <MediaManager
              media={media}
              onChange={setMedia}
              cdnUrl={cdnUrl}
              pendingFiles={pendingFiles}
              onPendingProcessed={() => setPendingFiles([])}
              userRole={userRole}
            />
          </section>

          {/* Save */}
          <div class="editor-actions">
            {error && !githubUrl && <div class="auth-error">{error}</div>}
            {saved && (
              <div class="save-success">
                Saved! Your changes will be live in a few minutes.
                {' '}<a href={initialData.tour_slug ? `/tours/${initialData.tour_slug}/${initialData.slug}` : `/rides/${initialData.slug}`}>View ride</a>
              </div>
            )}
            <button type="button" class="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        {/* RIGHT PANE: Preview */}
        <div class={`ride-editor-preview ${activeTab !== 'preview' ? 'ride-editor-pane--hidden' : ''}`}>
          <RidePreview
            name={name}
            body={body}
            media={media}
            cdnUrl={cdnUrl}
            rideDate={rideDate}
            country={country}
            distanceKm={distanceKm}
            elevationM={elevation ? elevation.elevGain : undefined}
            movingTimeS={track?.moving_time_s}
            averageSpeedKmh={track?.average_speed_kmh}
            mapThumbnail={mapThumbnail}
            labels={rideLabels}
            coordinates={coordinates}
            elevation={elevation}
          />
        </div>
      </div>
    </div>
  );
}
