// AGENTS.md: See src/components/admin/AGENTS.md for editor rules.
// Key: textarea hydration workaround required, contentHash must sync after save, all styles in admin.scss.
import { useState } from 'preact/hooks';
import MediaManager from './MediaManager';
import type { MediaItem } from './MediaManager';
import VariantManager from './VariantManager';
import type { VariantItem } from './VariantManager';
import MarkdownEditor from './MarkdownEditor';
import NearbyPhotos from './NearbyPhotos';
import EditorActions from './EditorActions';
import { useEditorState } from './useEditorState';
import { useFormValidation } from './useFormValidation';
import { useDragDrop } from '../../lib/hooks';
import type { RouteDetail } from '../../lib/models/route-model';
import type { RouteUpdate } from '../../views/api/route-save'; // type-only import: compile-time check, no runtime bundle impact
import SlugEditor from './SlugEditor';
import nearbyPhotosMap from 'virtual:bike-app/nearby-photos';
import { toParkedEntry } from '../../lib/media-merge';
import type { ParkedPhotoEntry } from '../../lib/media-merge';
import { localeLabel } from '../../lib/i18n/locale-utils';

interface Props {
  initialData: RouteDetail & { contentHash?: string; isNew?: boolean };
  cdnUrl: string;
  videosCdnUrl?: string;
  parkedPhotos?: ParkedPhotoEntry[];
  tagTranslations?: Record<string, Record<string, string>>;
  knownTags?: string[];
  defaultLocale?: string;
  userRole?: string;
  showLicenseNotice?: boolean;
}

// eslint-disable-next-line bike-app/no-hardcoded-city-locale -- fallback default for prop
export default function RouteEditor({ initialData, cdnUrl, videosCdnUrl, parkedPhotos: initialParkedPhotos = [], tagTranslations = {}, knownTags = [], defaultLocale = 'en', userRole, showLicenseNotice }: Props) {
  const [name, setName] = useState(initialData.name);
  const [tagline, setTagline] = useState(initialData.tagline);
  const [tags, setTags] = useState(initialData.tags);
  const [tagInput, setTagInput] = useState('');
  const [status, setStatus] = useState(initialData.status);
  const [body, setBody] = useState(initialData.body);
  const [media, setMedia] = useState<MediaItem[]>(initialData.media);
  const [parkedPhotos, setParkedPhotos] = useState(initialParkedPhotos);
  const [newlyParked, setNewlyParked] = useState<ParkedPhotoEntry[]>([]);
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

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingGpxFiles, setPendingGpxFiles] = useState<File[]>([]);

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
      const payload: RouteUpdate = {
        frontmatter: {
          name,
          tagline,
          tags,
          status,
        },
        body,
        ...(slug !== initialData.slug ? { newSlug: slug } : {}),
        media,
        ...(newlyParked.length > 0 ? { parkedPhotos: newlyParked } : {}),
        ...(deletedParkedKeys.length > 0 ? { deletedParkedKeys } : {}),
        variants,
        translations,
      };
      return payload as unknown as Record<string, unknown>;
    },
    onSuccess: (result) => {
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
    <div class="route-editor">
      {dragging && (
        <div class="drop-overlay">
          <div class="drop-overlay-content">Drop media or GPX files to add to route</div>
        </div>
      )}
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

      <section class="editor-section">
        <h2>Photos</h2>
        <MediaManager
          media={media}
          onChange={setMedia}
          cdnUrl={cdnUrl}
          videosCdnUrl={videosCdnUrl}
          pendingFiles={pendingFiles}
          onPendingProcessed={() => setPendingFiles([])}
          userRole={userRole}
          contentSlug={initialData.slug}
          contentKind="route"
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
        <NearbyPhotos
          nearbyPhotos={nearbyPhotosMap[initialData.slug] || []}
          parkedPhotos={parkedPhotos}
          currentMediaKeys={new Set(media.map(m => m.key))}
          cdnUrl={cdnUrl}
          userRole={userRole}
          initiallyExpanded={media.length === 0}
          onAddPhoto={(photo, wasParked) => {
            setMedia([...media, photo]);
            if (wasParked) {
              setParkedPhotos(prev => prev.filter(p => p.key !== photo.key));
            }
          }}
          onParkPhoto={(photo) => {
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

      <section class="editor-section">
        <h2>Route Options</h2>
        <VariantManager
          variants={variants}
          onChange={setVariants}
          pendingFiles={pendingGpxFiles}
          onPendingProcessed={() => setPendingGpxFiles([])}
        />
      </section>

      <EditorActions
        error={error} githubUrl={githubUrl} saved={saved} saving={saving}
        onSave={handleSave} contentType="route" userRole={userRole}
        viewLink={`/routes/${initialData.slug}`}
        showLicenseNotice={showLicenseNotice !== false}
      />
    </div>
  );
}
