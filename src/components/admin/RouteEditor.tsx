// AGENTS.md: See src/components/admin/AGENTS.md for editor rules.
// Key: textarea hydration workaround required, contentHash must sync after save, all styles in admin.scss.
import { useState, useRef, useEffect, useMemo } from 'preact/hooks';
import { useUnsavedGuard } from '../../lib/hooks/use-unsaved-guard';
import MediaManager from './MediaManager';
import type { MediaItem } from './MediaManager';
import VariantManager from './VariantManager';
import type { VariantItem } from './VariantManager';
import MarkdownEditor from './MarkdownEditor';
import NearbyMedia from './NearbyMedia';
import EditorActions from './EditorActions';
import RoutePreview from './RoutePreview';
import EditorFocusWrapper from './EditorFocusWrapper';
import { FocusHeader } from './EditorFocusWrapper';
import { useEditorState } from './useEditorState';
import { useFormValidation } from './useFormValidation';
import { useDragDrop, useHydrated } from '../../lib/hooks';
import type { RouteDetail } from '../../lib/models/route-model';
import type { RouteUpdate } from '../../views/api/route-save'; // type-only import: compile-time check, no runtime bundle impact
import StaticRouteMap from './StaticRouteMap';
import { parseGpx } from '../../lib/gpx/parse';
import SlugEditor from './SlugEditor';
import { toParkedEntry } from '../../lib/media/media-merge';
import type { ParkedMediaEntry } from '../../lib/media/media-merge';
import { localeLabel } from '../../lib/i18n/locale-utils';

interface Props {
  initialData: RouteDetail & { contentHash?: string; isNew?: boolean };
  cdnUrl: string;
  videosCdnUrl?: string;
  videoPrefix?: string;
  parkedPhotos?: ParkedMediaEntry[];
  tagTranslations?: Record<string, Record<string, string>>;
  knownTags?: string[];
  defaultLocale?: string;
  userRole?: string;
  showLicenseNotice?: boolean;
  focusMode?: 'description' | 'media' | null;
  focusLabels?: { description: string; media: string; showAll: string };
  nearbyMedia?: Array<{ key: string; lat: number; lng: number; routeSlug: string; caption?: string; width?: number; height?: number; type?: 'photo' | 'video' }>;
}

// eslint-disable-next-line bike-app/no-hardcoded-city-locale -- fallback default for prop
export default function RouteEditor({ initialData, cdnUrl, videosCdnUrl, videoPrefix, parkedPhotos: initialParkedPhotos = [], tagTranslations = {}, knownTags = [], defaultLocale = 'en', userRole, showLicenseNotice, focusMode, focusLabels, nearbyMedia = [] }: Props) {
  const hydratedRef = useHydrated<HTMLDivElement>();
  const [name, setName] = useState(initialData.name);
  const [tagline, setTagline] = useState(initialData.tagline);
  const [tags, setTags] = useState(initialData.tags);
  const [tagInput, setTagInput] = useState('');
  const [status, setStatus] = useState(initialData.status);
  const [body, setBody] = useState(initialData.body);
  const [media, setMedia] = useState<MediaItem[]>(initialData.media);
  const [parkedPhotos, setParkedPhotos] = useState(initialParkedPhotos);
  const [newlyParked, setNewlyParked] = useState<ParkedMediaEntry[]>([]);
  const [deletedParkedKeys, setDeletedParkedKeys] = useState<string[]>([]);
  const [variants, setVariants] = useState<VariantItem[]>(initialData.variants || []);
  const [slug, setSlug] = useState(initialData.slug);

  const [activeLocale, setActiveLocale] = useState(defaultLocale);
  const [translations, setTranslations] = useState<Record<string, { name: string; tagline: string; body: string }>>(
    Object.fromEntries(
      Object.entries(initialData.translations || {}).map(([locale, t]) => [
        locale,
        { name: t.name || '', tagline: t.tagline || '', body: t.body || '' },
      ])
    )
  );

  const routeCoordinates = useMemo(() => {
    const firstVariant = variants.find(v => v.gpxContent);
    if (!firstVariant?.gpxContent) return [];
    try {
      const track = parseGpx(firstVariant.gpxContent);
      return track.points.map(p => [p.lon, p.lat] as [number, number]);
    } catch {
      return [];
    }
  }, [variants]);

  const [focusExpanded, setFocusExpanded] = useState(false);
  const effectiveFocus = focusExpanded ? null : (focusMode || null);

  // Mobile tabs for edit/preview
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingGpxFiles, setPendingGpxFiles] = useState<File[]>([]);

  const [dirty, setDirty] = useState(false);
  const initialRender = useRef(true);
  useEffect(() => {
    if (initialRender.current) { initialRender.current = false; return; }
    setDirty(true);
  }, [name, tagline, tags, status, body, media, variants, slug, translations]);

  const hasTranscoding = media.some(m => m.videoStatus && m.videoStatus !== 'ready');
  useUnsavedGuard(dirty || hasTranscoding);

  const { validate } = useFormValidation([
    { field: 'route-name', check: () => !name.trim(), message: 'Name is required' },
    { field: '', check: () => !variants.length, message: 'At least one route option is required' },
  ]);

  const { saving, saved, error, githubUrl, save: handleSave } = useEditorState({
    apiBase: '/api/routes',
    contentId: initialData.slug,
    initialContentHash: initialData.contentHash,
    userRole,
    validate,
    buildPayload: () => {
      const cleanMedia = media.map(({ videoStatus, uploadPercent, transcodingStartedAt, posterChecked, ...rest }) => rest);
      const payload: RouteUpdate = {
        frontmatter: {
          name,
          tagline,
          tags,
          status,
        },
        body,
        ...(slug !== initialData.slug ? { newSlug: slug } : {}),
        media: cleanMedia,
        ...(newlyParked.length > 0 ? { parkedPhotos: newlyParked } : {}),
        ...(deletedParkedKeys.length > 0 ? { deletedParkedKeys } : {}),
        variants,
        translations,
      };
      return payload as unknown as Record<string, unknown>;
    },
    onSuccess: (result) => {
      setDirty(false);
      if (initialData.isNew) {
        window.location.href = `/admin/routes/${initialData.slug}`;
      }
    },
  });

  const { dragging } = useDragDrop((files) => {
    const mediaFiles = files.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
    const gpxFiles = files.filter(f => f.name.toLowerCase().endsWith('.gpx'));
    if (mediaFiles.length > 0) setPendingFiles(mediaFiles);
    if (gpxFiles.length > 0) setPendingGpxFiles(gpxFiles);
  });

  function getField(field: 'name' | 'tagline' | 'body'): string {
    if (activeLocale === defaultLocale) {
      return field === 'name' ? name : field === 'tagline' ? tagline : body;
    }
    return translations[activeLocale]?.[field] || '';
  }

  function setField(field: 'name' | 'tagline' | 'body', value: string) {
    if (activeLocale === defaultLocale) {
      if (field === 'name') setName(value);
      else if (field === 'tagline') setTagline(value);
      else setBody(value);
      return;
    }
    setTranslations(prev => ({
      ...prev,
      [activeLocale]: {
        ...(prev[activeLocale] || { name: '', tagline: '', body: '' }),
        [field]: value,
      },
    }));
  }

  function displayTag(tag: string): string {
    if (activeLocale === defaultLocale) return tag;
    return tagTranslations[tag]?.[activeLocale] ?? tag;
  }

  function resolveTag(input: string): string {
    // If it matches a known tag directly, use it
    if (knownTags.includes(input)) return input;
    // Check if input matches a translation, reverse-map to the primary key
    for (const [key, locales] of Object.entries(tagTranslations)) {
      for (const translated of Object.values(locales)) {
        if (translated.toLowerCase() === input) return key;
      }
    }
    return input;
  }

  function addTag() {
    const raw = tagInput.trim().toLowerCase();
    if (!raw) { setTagInput(''); return; }
    const tag = resolveTag(raw);
    if (!tags.includes(tag)) {
      setTags([...tags, tag]);
    }
    setTagInput('');
  }

  function removeTag(tag: string) {
    setTags(tags.filter((t) => t !== tag));
  }

  function handleTagKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag();
    }
  }

  return (
    <div class="route-editor" ref={hydratedRef}>
      {dragging && (
        <div class="drop-overlay">
          <div class="drop-overlay-content">Drop photos, videos, or GPX files here</div>
        </div>
      )}
      {effectiveFocus && focusLabels && (
        <FocusHeader
          focusSection={effectiveFocus}
          labels={{ description: focusLabels.description, media: focusLabels.media }}
          showAllLabel={focusLabels.showAll}
          onExpand={() => setFocusExpanded(true)}
        />
      )}

      {/* Mobile tabs — hidden in focus mode */}
      <div class={`route-editor-tabs ${effectiveFocus ? 'route-editor-tabs--hidden' : ''}`}>
        <button
          type="button"
          class={`route-editor-tab ${activeTab === 'edit' ? 'route-editor-tab--active' : ''}`}
          onClick={() => setActiveTab('edit')}
        >Edit</button>
        <button
          type="button"
          class={`route-editor-tab ${activeTab === 'preview' ? 'route-editor-tab--active' : ''}`}
          onClick={() => setActiveTab('preview')}
        >Preview</button>
      </div>

      <div class="route-editor-panes">
        {/* LEFT PANE: Editor */}
        <div class={`route-editor-edit ${activeTab !== 'edit' ? 'route-editor-pane--hidden' : ''}`}>
      <EditorFocusWrapper focused={effectiveFocus === 'description'} focusActive={!!effectiveFocus}>
      <div class="locale-tabs">
        {[defaultLocale, ...Object.keys(translations).filter(l => l !== defaultLocale)].map(locale => (
          <button
            key={locale}
            type="button"
            class={`locale-tab ${activeLocale === locale ? 'locale-tab--active' : ''}`}
            onClick={() => setActiveLocale(locale)}
          >
            {localeLabel(locale)}
          </button>
        ))}
      </div>
      {routeCoordinates.length > 0 && (
        <details class="route-editor-map-details" open>
          <summary>Route map</summary>
          <StaticRouteMap coordinates={routeCoordinates} class="route-editor-map" />
        </details>
      )}
      <div class="auth-form">
          <div class="form-field">
            <label for="route-name">Name</label>
            <input
              id="route-name"
              type="text"
              value={getField('name')}
              onInput={(e) => setField('name', (e.target as HTMLInputElement).value)}
            />
          </div>

          {userRole !== 'guest' && (
            <div class="editor-slug">
              <SlugEditor slug={slug} onSlugChange={setSlug} prefix="/routes/" />
              {slug !== initialData.slug && (
                <span class="editor-slug-changed">URL will change — old URL will redirect</span>
              )}
            </div>
          )}

          <div class="form-field">
            <label for="route-tagline">Tagline</label>
            <input
              id="route-tagline"
              type="text"
              value={getField('tagline')}
              onInput={(e) => setField('tagline', (e.target as HTMLInputElement).value)}
            />
          </div>

          <div class="form-field">
            <label>Tags</label>
            <div class="tag-editor">
              {tags.map((tag) => (
                <span key={tag} class="tag-pill">
                  {displayTag(tag)}
                  <button type="button" onClick={() => removeTag(tag)}>{'×'}</button>
                </span>
              ))}
              <input
                type="text"
                class="tag-input"
                list="tag-suggestions"
                value={tagInput}
                onInput={(e) => setTagInput((e.target as HTMLInputElement).value)}
                onKeyDown={handleTagKeyDown}
                onBlur={addTag}
                placeholder="Add tag..."
              />
              <datalist id="tag-suggestions">
                {knownTags
                  .filter(t => !tags.includes(t))
                  .flatMap(tag => {
                    const options = [<option key={tag} value={tag} />];
                    if (activeLocale !== defaultLocale) {
                      const translated = tagTranslations[tag]?.[activeLocale];
                      if (translated) {
                        options.push(<option key={`${tag}-${activeLocale}`} value={translated} />);
                      }
                    } else {
                      // In default locale, also add non-default translations so users can search in any language
                      const locales = tagTranslations[tag];
                      if (locales) {
                        for (const [locale, translated] of Object.entries(locales)) {
                          options.push(<option key={`${tag}-${locale}`} value={translated} />);
                        }
                      }
                    }
                    return options;
                  })}
              </datalist>
            </div>
          </div>

          {userRole === 'admin' && (
            <div class="form-field">
              <label for="route-status">Status</label>
              <select
                id="route-status"
                value={status}
                onChange={(e) => setStatus((e.target as HTMLSelectElement).value)}
              >
                <option value="published">Published</option>
                <option value="draft">Draft</option>
              </select>
            </div>
          )}

          <div class="form-field">
            <label for="route-body">Body (markdown)</label>
            <MarkdownEditor
              id="route-body"
              value={getField('body')}
              onChange={(text) => setField('body', text)}
              textareaKey={`body-${activeLocale}`}
              rows={12}
            />
          </div>
        </div>
      </EditorFocusWrapper>

      <EditorFocusWrapper focused={effectiveFocus === 'media'} focusActive={!!effectiveFocus}>
      <section class="editor-section">
        <h2>Photos and Videos</h2>
        <MediaManager
          media={media}
          onChange={setMedia}
          cdnUrl={cdnUrl}
          videosCdnUrl={videosCdnUrl}
          videoPrefix={videoPrefix}
          pendingFiles={pendingFiles}
          onPendingProcessed={() => setPendingFiles([])}
          userRole={userRole}
          contentSlug={initialData.slug}
          contentKind="route"
          onUpdateItem={(key, patch) => setMedia(prev => prev.map(item =>
            item.key === key ? { ...item, ...patch } : item
          ))}
          onParkPhoto={(photo) => {
            const entry = toParkedEntry(photo);
            setParkedPhotos(prev => [...prev, entry]);
            setNewlyParked(prev => [...prev, entry]);
          }}
          onSuggestionDrop={(photo, wasParked) => {
            setMedia(prev => [...prev, photo]);
            if (wasParked) {
              setParkedPhotos(prev => prev.filter(p => p.key !== photo.key));
            }
          }}
        />
        <NearbyMedia
          nearbyMedia={nearbyMedia}
          parkedMedia={parkedPhotos}
          currentMediaKeys={new Set(media.map(m => m.key))}
          cdnUrl={cdnUrl}
          videosCdnUrl={videosCdnUrl}
          videoPrefix={videoPrefix}
          userRole={userRole}
          initiallyExpanded={media.length === 0}
          onAddMedia={(photo, wasParked) => {
            setMedia([...media, photo]);
            if (wasParked) {
              setParkedPhotos(prev => prev.filter(p => p.key !== photo.key));
            }
          }}
          onParkMedia={(photo) => {
            setMedia(prev => prev.filter(m => m.key !== photo.key));
            const entry = toParkedEntry(photo);
            setParkedPhotos(prev => [...prev, entry]);
            setNewlyParked(prev => [...prev, entry]);
          }}
          onDeleteParked={(key) => {
            setParkedPhotos(prev => prev.filter(p => p.key !== key));
            setDeletedParkedKeys(prev => [...prev, key]);
          }}
        />
      </section>
      </EditorFocusWrapper>

      <EditorFocusWrapper focused={false} focusActive={!!effectiveFocus}>
      <section class="editor-section">
        <h2>Route Options</h2>
        <VariantManager
          variants={variants}
          onChange={setVariants}
          pendingFiles={pendingGpxFiles}
          onPendingProcessed={() => setPendingGpxFiles([])}
        />
      </section>
      </EditorFocusWrapper>

      <EditorActions
        error={error} githubUrl={githubUrl} saved={saved} saving={saving}
        onSave={handleSave} contentType="route" userRole={userRole}
        viewLink={`/routes/${initialData.slug}`}
        showLicenseNotice={showLicenseNotice !== false}
        licenseDocsUrl="https://whereto.bike/about/licensing/"
      />
        </div>

        {/* RIGHT PANE: Preview */}
        <div class={`route-editor-preview ${activeTab !== 'preview' ? 'route-editor-pane--hidden' : ''}`}>
          <RoutePreview
            name={getField('name')}
            tagline={getField('tagline')}
            tags={tags}
            body={getField('body')}
            media={media}
            cdnUrl={cdnUrl}
            videosCdnUrl={videosCdnUrl}
            videoPrefix={videoPrefix}
            displayTag={displayTag}
          />
        </div>
      </div>
    </div>
  );
}
