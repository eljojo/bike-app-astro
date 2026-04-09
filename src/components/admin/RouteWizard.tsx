import { useState, useRef, useMemo } from 'preact/hooks';
import { useHydrated } from '../../lib/hooks';
import WizardLayout, { WizardNav } from './WizardLayout';
import type { MediaItem } from './MediaManager';
import type { VariantItem } from './VariantManager';
import { slugify } from '../../lib/slug';
import { parseGpx } from '../../lib/gpx/parse';
import { computeElevationPoints } from '../../lib/geo/elevation-profile';
import InteractiveElevation from '../InteractiveElevation';
import StaticRouteMap from './StaticRouteMap';
import { buildMediaThumbnailUrl } from '../../lib/media/image-service';
import type { MediaThumbnailConfig } from '../../lib/media/image-service';
import { findNearbyMedia } from '../../lib/geo/media-proximity';
import MediaManager from './MediaManager';
import NearbyMedia from './NearbyMedia';
import MarkdownEditor from './MarkdownEditor';
import TagEditor from './TagEditor';
import RoutePreview from './RoutePreview';
import { useEditorForm } from './useEditorForm';
import type { RouteUpdate } from '../../views/api/route-save';

const STOPS = ['Route', 'Story', 'Photos', 'Go Live'];

interface Props {
  cdnUrl: string;
  videosCdnUrl?: string;
  videoPrefix?: string;
  mediaLocations?: Array<{ key: string; lat: number; lng: number; routeSlug: string; caption?: string; width?: number; height?: number; type?: 'photo' | 'video' }>;
  knownTags?: string[];
  tagTranslations?: Record<string, Record<string, string>>;
  defaultLocale?: string;
  userRole?: string;
  showLicenseNotice?: boolean;
  guestLabel?: string;
  cityName?: string;
}

export default function RouteWizard({
  cdnUrl, videosCdnUrl, videoPrefix, mediaLocations = [],
  // eslint-disable-next-line bike-app/no-hardcoded-city-locale -- fallback default for prop
  knownTags = [], tagTranslations = {}, defaultLocale = 'en',
  userRole, showLicenseNotice, guestLabel, cityName = 'your city',
}: Props) {
  const hydratedRef = useHydrated<HTMLDivElement>();
  const thumbConfig: MediaThumbnailConfig = { cdnUrl, videosCdnUrl, videoPrefix };
  const [step, setStep] = useState(0);

  // Step 1: Route data
  const [gpxContent, setGpxContent] = useState('');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 2: Story data
  const [tagline, setTagline] = useState('');
  const [body, setBody] = useState('');

  // Step 3: Photos data
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  // Tags (part of Story step)
  const [tags, setTags] = useState<string[]>([]);

  // Variant (from GPX)
  const [variants, setVariants] = useState<VariantItem[]>([]);

  // Track skipped steps for celebration nudges
  const [skippedSteps, setSkippedSteps] = useState<string[]>([]);
  function skipStep(field: string, nextStep: number) {
    setSkippedSteps(prev => [...prev, field]);
    setStep(nextStep);
  }

  // GPX-derived data
  const track = useMemo(() => gpxContent ? parseGpx(gpxContent) : null, [gpxContent]);
  const elevationPoints = useMemo(
    () => track ? computeElevationPoints(track.points, track.distance_m) : [],
    [track],
  );
  const coordinates = useMemo(
    () => track ? track.points.map(p => [p.lon, p.lat] as [number, number]) : [],
    [track],
  );
  const nearbyPhotos = useMemo(() => {
    if (!track || track.points.length === 0) return [];
    const sampleStep = Math.max(1, Math.floor(track.points.length / 50));
    const sampled = track.points.filter((_, i) => i % sampleStep === 0);
    const trackPts = sampled.map(p => ({ lat: p.lat, lng: p.lon }));
    return findNearbyMedia(trackPts, mediaLocations, '');
  }, [track]);

  const hasTranscoding = media.some(m => m.videoStatus && m.videoStatus !== 'ready');

  // Save flow
  const editor = useEditorForm({
    apiBase: '/api/routes',
    contentId: null,
    userRole,
    extraDirty: hasTranscoding,
    deps: [name, tagline, tags, body, media, variants, slug],
    validate: () => {
      if (!name.trim()) return 'Name is required';
      if (!variants.length) return 'At least one route option is required';
      return null;
    },
    buildPayload: () => {
      const cleanMedia = media.map(({ videoStatus: _vs, uploadPercent: _up, transcodingStartedAt: _ts, posterChecked: _pc, ...rest }) => rest);
      const payload: RouteUpdate = {
        frontmatter: { name, tagline, tags, status: 'published' as const },
        body,
        newSlug: slug,
        media: cleanMedia,
        variants,
        translations: {},
      };
      return payload as unknown as Record<string, unknown>;
    },
    onSuccess: (result) => {
      const id = result?.id || slug;
      const qs = new URLSearchParams({
        first: 'true',
        ...(skippedSteps.length > 0 ? { skipped: skippedSteps.join(',') } : {}),
      });
      window.location.href = `/admin/celebrate/route/${id}?${qs}`;
    },
  });

  // GPX handling
  function handleGpxFile(file: File) {
    setUploadError('');
    if (!file.name.endsWith('.gpx')) {
      setUploadError('Please upload a .gpx file');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      setGpxContent(content);
      const baseName = file.name.replace(/\.gpx$/i, '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      setName(baseName);
      setSlug(slugify(baseName));
      setVariants([{ name: baseName, gpx: 'main.gpx', isNew: true, gpxContent: content }]);
    };
    reader.onerror = () => setUploadError('Failed to read GPX file');
    reader.readAsText(file);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.[0]) handleGpxFile(e.dataTransfer.files[0]);
  }

  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files?.[0]) { handleGpxFile(input.files[0]); input.value = ''; }
  }

  async function handleUrlImport() {
    if (!importUrl.trim()) return;
    setUploadError('');
    setImporting(true);
    try {
      const res = await fetch('/api/gpx/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: importUrl }),
      });
      if (!res.ok) { const data = await res.json(); throw new Error(data.error || 'Import failed'); }
      const { gpxContent: content, name: routeName, sourceUrl: resolvedUrl } = await res.json();
      setGpxContent(content);
      setName(routeName);
      setSlug(slugify(routeName));
      setImportUrl('');
      setVariants([{
        name: routeName, gpx: 'main.gpx', isNew: true, gpxContent: content,
        ...(resolvedUrl.includes('ridewithgps.com') && { rwgps_url: resolvedUrl }),
        ...((resolvedUrl.includes('google.com/maps/d/') || resolvedUrl.includes('google.com/maps/dir/')) && { google_maps_url: resolvedUrl }),
      }]);
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  function validateSlug(): boolean {
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) {
      setUploadError('URL slug must be lowercase letters, numbers, and hyphens');
      return false;
    }
    return true;
  }

  function slugToName(s: string): string {
    return s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  // --- Step renderers ---

  function renderWelcome() {
    return (
      <div class="wizard-welcome">
        <h1 class="wizard-welcome-heading">Share a route you love</h1>
        <p class="wizard-welcome-body">
          You're about to add a cycling route that anyone in {cityName} can find and ride.
          You'll need a <a href="https://whereto.bike/guides/gpx-files/" target="_blank" rel="noopener noreferrer">GPS recording</a> of the route — a GPX file or a link to Strava,
          RideWithGPS, or Google Maps. The rest (description, photos, tags) makes the route
          easier to find, but you can skip those and come back later.
        </p>
        <div class="wizard-welcome-begin">
          <button type="button" class="btn-primary" onClick={() => setStep(1)}>
            Let's go
          </button>
        </div>
        <p class="wizard-welcome-skip">
          <button type="button" class="btn-link" onClick={() => { window.location.href = '/admin/routes/new?full=1'; }}>
            Skip to full editor
          </button>
        </p>
      </div>
    );
  }

  function renderRoute() {
    if (!gpxContent) {
      return (
        <>
          <h2 class="wizard-step-heading">Where does it go?</h2>
          <p class="wizard-step-subheading">
            Upload a GPS recording of the route, or paste a link from a cycling app.
          </p>
          <div class="route-creator-prompt" style="margin-top: 0;">
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
              <input ref={fileInputRef} type="file" accept=".gpx" style="display:none" onChange={handleFileSelect} />
            </div>
            <div class="creator-divider"><span>or</span></div>
            <div class="url-import">
              <input type="url" class="url-import-input" placeholder="Paste a RideWithGPS or Google Maps link" value={importUrl}
                onInput={(e) => setImportUrl((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleUrlImport(); } }} />
              {importUrl.trim() && (
                <button type="button" class="btn-secondary" onClick={handleUrlImport} disabled={importing}>
                  {importing ? 'Importing...' : 'Import'}
                </button>
              )}
            </div>
            <a href="https://whereto.bike/guides/gpx-files/" target="_blank" rel="noopener noreferrer" class="route-creator-help-link">What's a GPX file?</a>
          </div>
          {uploadError && <div class="auth-error">{uploadError}</div>}
        </>
      );
    }

    return (
      <>
        <h2 class="wizard-step-heading">Name your route</h2>
        <div class="route-creator-setup">
          <div class="route-preview-actions">
            <div class="form-field">
              <label for="new-route-name">Route name</label>
              <input id="new-route-name" type="text" value={name}
                onInput={(e) => { const val = (e.target as HTMLInputElement).value; setName(val); setSlug(slugify(val)); }} />
            </div>
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
            {elevationPoints.length > 0 && <InteractiveElevation points={elevationPoints} />}
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
                      <img key={photo.key} src={buildMediaThumbnailUrl(photo, thumbConfig, { width: 120, height: 120, fit: 'cover' })} alt={photo.caption || ''} loading="lazy" />
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
        <WizardNav onBack={() => { setGpxContent(''); setVariants([]); setName(''); setSlug(''); setUploadError(''); }}
          onNext={() => { if (name.trim() && validateSlug()) setStep(2); }}
          nextDisabled={!name.trim()} />
        {uploadError && <div class="auth-error">{uploadError}</div>}
      </>
    );
  }

  function renderStory() {
    return (
      <>
        <h2 class="wizard-step-heading">What makes this ride worth doing?</h2>
        <p class="wizard-step-subheading">
          A short tagline and a description help people decide if this route is for them.
        </p>
        <div class="auth-form">
          <div class="form-field">
            <label for="wizard-tagline">Tagline</label>
            <span class="form-field-hint">A one-sentence hook — what would make someone click?</span>
            <input id="wizard-tagline" type="text" value={tagline}
              onInput={(e) => setTagline((e.target as HTMLInputElement).value)}
              placeholder="Twelve kilometres along the river, with a bakery at the turnaround" />
          </div>
          <div class="form-field">
            <label for="wizard-body">Description</label>
            <span class="form-field-hint">Describe the ride — where it goes, what you'll see, where to stop.</span>
            <MarkdownEditor id="wizard-body" value={body} onChange={setBody} rows={8}
              placeholder="The route follows the river path from the market to the falls. The surface is paved the whole way — good for any bike. There's a bench with a view at the halfway point, and the cafe at kilometre four has the best croissants in the city." />
            <span class="form-field-hint" style="margin-top: 0.25rem;">Formatting supported</span>
          </div>
          <div class="form-field">
            <label>Tags</label>
            <span class="form-field-hint">Help people find this route</span>
            <TagEditor tags={tags} onTagsChange={setTags} knownTags={knownTags}
              tagTranslations={tagTranslations} activeLocale={defaultLocale}
              datalistId="wizard-tag-suggestions" />
          </div>
        </div>
        <WizardNav onBack={() => setStep(1)} onNext={() => setStep(3)}
          skipLabel="Skip for now" onSkip={() => skipStep('body', 3)} />
      </>
    );
  }

  function renderPhotos() {
    return (
      <>
        <h2 class="wizard-step-heading">Show people what it's like</h2>
        <p class="wizard-step-subheading">
          One good photo can be the reason someone tries this ride.
        </p>
        <MediaManager media={media} onChange={setMedia} cdnUrl={cdnUrl}
          videosCdnUrl={videosCdnUrl} videoPrefix={videoPrefix}
          pendingFiles={pendingFiles} onPendingProcessed={() => setPendingFiles([])}
          userRole={userRole} contentSlug={slug} contentKind="route" />
        {nearbyPhotos.length > 0 && (
          <NearbyMedia nearbyMedia={nearbyPhotos} parkedMedia={[]}
            currentMediaKeys={new Set(media.map(m => m.key))}
            cdnUrl={cdnUrl} videosCdnUrl={videosCdnUrl} videoPrefix={videoPrefix}
            userRole={userRole} initiallyExpanded={media.length === 0}
            onAddMedia={(photo) => setMedia(prev => [...prev, photo])}
            onParkMedia={() => {}} onDeleteParked={() => {}} />
        )}
        <WizardNav onBack={() => setStep(2)} onNext={() => setStep(4)}
          skipLabel="Skip for now" onSkip={() => skipStep('media', 4)} />
      </>
    );
  }

  function renderReview() {
    return (
      <>
        <h2 class="wizard-step-heading">Here's how it'll look</h2>
        <p class="wizard-step-subheading">This is what people will see when they find your route.</p>
        <RoutePreview name={name} tagline={tagline} tags={tags} body={body}
          media={media} cdnUrl={cdnUrl} videosCdnUrl={videosCdnUrl} videoPrefix={videoPrefix} />
        {userRole === 'guest' && guestLabel && <p class="editor-guest-label">{guestLabel}</p>}
        {editor.error && <div class="auth-error">{editor.error}</div>}
        {showLicenseNotice && (
          <p class="editor-license-notice">
            Your contribution will be shared under{' '}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>.
            {' '}<a href="https://whereto.bike/about/licensing/" target="_blank" rel="noopener">What does this mean?</a>
          </p>
        )}
        <WizardNav onBack={() => setStep(3)} onNext={editor.save}
          nextLabel={editor.saving ? 'Saving...' : 'Save'} nextDisabled={editor.saving} />
      </>
    );
  }

  const stepRenderers = [renderWelcome, renderRoute, renderStory, renderPhotos, renderReview];

  return (
    <div ref={hydratedRef}>
      <WizardLayout stops={STOPS} currentStep={step} onStepChange={setStep}>
        {stepRenderers[step]()}
      </WizardLayout>
    </div>
  );
}
