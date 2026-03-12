// AGENTS.md: See src/components/admin/AGENTS.md for editor rules.
// Key: textarea hydration workaround required, contentHash must sync after save, all styles in admin.scss.
import { useState, useRef, useCallback } from 'preact/hooks';
import MediaManager from './MediaManager';
import type { MediaItem } from './MediaManager';
import type { VariantItem } from './VariantManager';
import AutoDetectField from './AutoDetectField';
import MarkdownToolbar from './MarkdownToolbar';
import RidePreview from './RidePreview';
import { useEditorState } from './useEditorState';
import { useTextareaValue, useDragDrop } from '../../lib/hooks';
import { slugify } from '../../lib/slug';
import { extractRideDate } from '../../lib/gpx';
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

interface Props {
  initialData: RideDetail & { contentHash?: string; isNew?: boolean; gpxRelativePath?: string };
  cdnUrl: string;
  userRole?: string;
  mapThumbnail?: string;
  rideLabels?: Record<string, string>;
  tours?: TourInfo[];
}

export default function RideEditor({ initialData, cdnUrl, userRole, mapThumbnail, rideLabels, tours = [] }: Props) {
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

  // Mobile tabs
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');

  // Collapsible details (collapsed by default for existing rides)
  const [detailsOpen, setDetailsOpen] = useState(!!initialData.isNew);

  // Textarea ref (hydration workaround — see AGENTS.md)
  const bodyRef = useTextareaValue(body);

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
            mapThumbnail={mapThumbnail}
            labels={rideLabels}
          />
        </div>
      </div>
    </div>
  );
}
