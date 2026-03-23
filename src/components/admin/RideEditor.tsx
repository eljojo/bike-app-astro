// AGENTS.md: See src/components/admin/AGENTS.md for editor rules.
// Key: textarea hydration workaround required, contentHash must sync after save, all styles in admin.scss.
import { useState, useRef, useEffect, useMemo } from 'preact/hooks';
import MediaManager from './MediaManager';
import type { MediaItem } from './MediaManager';
import type { VariantItem } from './VariantManager';
import AutoDetectField from './AutoDetectField';
import MarkdownEditor from './MarkdownEditor';
import EditorActions from './EditorActions';
import RidePreview from './RidePreview';
import StravaActivityBrowser from './StravaActivityBrowser';
import type { StravaImportResult } from './StravaActivityBrowser';
import { useEditorState } from './useEditorState';
import { useFormValidation } from './useFormValidation';
import { useDragDrop, useHydrated } from '../../lib/hooks';
import { paths } from '../../lib/paths';
import { useUnsavedGuard } from '../../lib/hooks/use-unsaved-guard';
import { slugify } from '../../lib/slug';
import SlugEditor from './SlugEditor';
import { extractRideDate, parseGpx } from '../../lib/gpx/parse';
import { rideGpxFilename } from '../../lib/gpx/filenames';
import { computeElevationPoints } from '../../lib/geo/elevation-profile';
import type { ElevationPoint } from '../../lib/geo/elevation-profile';
import TourPicker from './TourPicker';
import type { RideDetail } from '../../lib/models/ride-model';
import type { TourSummary } from '../../types/admin';

interface Props {
  initialData: RideDetail & { contentHash?: string; isNew?: boolean; gpxRelativePath?: string };
  cdnUrl: string;
  videosCdnUrl?: string;
  videoPrefix?: string;
  userRole?: string;
  mapThumbnail?: string;
  rideLabels?: Record<string, string>;
  tours?: TourSummary[];
  stravaConnected?: boolean;
  guestLabel?: string;
}

export default function RideEditor({ initialData, cdnUrl, videosCdnUrl, videoPrefix, userRole, mapThumbnail, rideLabels, tours = [], stravaConnected, guestLabel }: Props) {
  const hydratedRef = useHydrated<HTMLDivElement>();
  // State
  const [name, setName] = useState(initialData.name);
  const [slug, setSlug] = useState(initialData.slug);
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

  const [dirty, setDirty] = useState(false);
  const initialRender = useRef(true);
  useEffect(() => {
    if (initialRender.current) { initialRender.current = false; return; }
    setDirty(true);
  }, [name, slug, status, body, media, variants, rideDate, country, tourSlug, highlight, privacyZone, stravaId]);

  const hasTranscoding = media.some(m => m.videoStatus && m.videoStatus !== 'ready');
  useUnsavedGuard(dirty || hasTranscoding);

  // Mobile tabs
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');

  // Collapsible details (collapsed by default for existing rides)
  const [detailsOpen, setDetailsOpen] = useState(!!initialData.isNew);

  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Strava browser toggle
  const [stravaBrowsing, setStravaBrowsing] = useState(false);

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
        const day = dateStr.split('-')[2] || '01';
        setVariants([{ name: result.name, gpx: rideGpxFilename(day, result.name), isNew: true, gpxContent: result.gpxContent }]);
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
        const countryName = data?.address?.country;
        if (countryName && !cancelled) setCountry(countryName);
      } catch { /* Nominatim failures are non-critical */ }
    })();

    return () => { cancelled = true; };
  }, [variants]);

  // Drag-and-drop
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const { dragging } = useDragDrop((files) => {
    const mediaFiles = files.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
    const gpx = files.filter(f => f.name.toLowerCase().endsWith('.gpx'));
    if (mediaFiles.length > 0) setPendingFiles(mediaFiles);
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

  // Handle Strava import result — populate editor fields
  function handleStravaImport(result: StravaImportResult) {
    setName(result.name);
    setStravaId(result.strava_id);
    setPrivacyZone(false); // Strava already trims

    const dateStr = result.start_date_local?.split('T')[0] || '';
    const day = dateStr.split('-')[2] || '01';
    if (dateStr && !rideDate) setRideDate(dateStr);
    setSlug(slugify(`${dateStr}-${result.name}`));
    setVariants([{
      name: result.name,
      gpx: rideGpxFilename(day, result.name),
      isNew: true,
      gpxContent: result.gpxContent,
    }]);

    if (result.photos?.length) {
      setMedia(result.photos.map((p, i) => ({
        key: p.key, caption: p.caption, lat: p.lat, lng: p.lng, cover: i === 0,
      })));
    }

    setStravaBrowsing(false);
  }

  // GPX stats from variant
  const gpxVariant = variants[0];
  const distanceKm = gpxVariant?.distance_km;

  // Parse GPX for map preview + elevation
  const gpxContent = gpxVariant?.gpxContent;
  const track = useMemo(() => gpxContent ? parseGpx(gpxContent) : null, [gpxContent]);
  const elevationPoints: ElevationPoint[] = useMemo(
    () => track ? computeElevationPoints(track.points, track.distance_m) : [],
    [track],
  );
  const coordinates = useMemo(
    () => track ? track.points.map(p => [p.lon, p.lat] as [number, number]) : [],
    [track],
  );

  // Save
  const { validate } = useFormValidation([
    { field: 'ride-name', check: () => !name.trim(), message: 'Name is required' },
    { field: '', check: () => !variants.length, message: 'A GPX file is required' },
  ]);

  const { saving, saved, error, githubUrl, guestCreated, save: handleSave, dismissSaved } = useEditorState({
    apiBase: '/api/rides',
    contentId: initialData.isNew ? null : initialData.slug,
    initialContentHash: initialData.contentHash,
    userRole,
    validate,
    buildPayload: () => {
      const cleanMedia = media.map(({ videoStatus, uploadPercent, transcodingStartedAt, posterChecked, ...rest }) => rest);
      return {
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
        media: cleanMedia,
        variants,
        ...(slug !== initialData.slug ? { newSlug: slug } : {}),
        gpxRelativePath: initialData.gpxRelativePath,
      };
    },
    onSuccess: (result) => {
      setDirty(false);
      if (initialData.isNew && result.id) {
        window.location.href = `/admin/rides/${result.id}`;
      }
    },
  });

  // GPX file input
  const gpxInputRef = useRef<HTMLInputElement>(null);

  return (
    <div class="ride-editor" ref={hydratedRef}>
      {dragging && (
        <div class="drop-overlay">
          <div class="drop-overlay-content">Drop photos, videos, or GPX files here</div>
        </div>
      )}

      {/* Strava activity browser modal */}
      {stravaBrowsing && (
        <StravaActivityBrowser
          onImport={handleStravaImport}
          onClose={() => setStravaBrowsing(false)}
        />
      )}

      {userRole === 'guest' && guestLabel && (
        <p class="editor-guest-label">{guestLabel}</p>
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
                  <SlugEditor slug={slug} onSlugChange={setSlug} prefix="/rides/" />
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
                  <button type="button" class="btn-secondary strava-import-btn" onClick={() => setStravaBrowsing(true)}>
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
            <MarkdownEditor
              id="ride-body"
              value={body}
              onChange={setBody}
              textareaRef={bodyRef}
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
              videosCdnUrl={videosCdnUrl}
              videoPrefix={videoPrefix}
              pendingFiles={pendingFiles}
              onPendingProcessed={() => setPendingFiles([])}
              userRole={userRole}
              contentSlug={slug}
              contentKind="ride"
              onUpdateItem={(key, patch) => setMedia(prev => prev.map(item =>
                item.key === key ? { ...item, ...patch } : item
              ))}
            />
          </section>

          {/* Save */}
          <EditorActions
            error={error} githubUrl={githubUrl} saved={saved} saving={saving}
            onSave={handleSave} onDismiss={dismissSaved} contentType="ride" userRole={userRole} guestCreated={guestCreated}
            viewLink={paths.ride(initialData.slug, initialData.tour_slug)}
            showLicenseNotice={false}
          />
        </div>

        {/* RIGHT PANE: Preview */}
        <div class={`ride-editor-preview ${activeTab !== 'preview' ? 'ride-editor-pane--hidden' : ''}`}>
          <RidePreview
            name={name}
            body={body}
            media={media}
            cdnUrl={cdnUrl}
            videosCdnUrl={videosCdnUrl}
            videoPrefix={videoPrefix}
            rideDate={rideDate}
            country={country}
            distanceKm={distanceKm}
            elevationM={track ? track.elevation_gain_m : undefined}
            movingTimeS={track?.moving_time_s}
            averageSpeedKmh={track?.average_speed_kmh}
            mapThumbnail={mapThumbnail}
            labels={rideLabels}
            coordinates={coordinates}
            elevationPoints={elevationPoints}
          />
        </div>
      </div>
    </div>
  );
}
