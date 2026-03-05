import { useState, useRef, useEffect } from 'preact/hooks';
import MediaManager from './MediaManager';
import type { MediaItem } from './MediaManager';
import VariantManager from './VariantManager';
import type { VariantItem } from './VariantManager';
import type { RouteDetail } from '../../lib/models/route-model';

interface Props {
  initialData: RouteDetail & { contentHash?: string; isNew?: boolean };
  cdnUrl: string;
  tagTranslations?: Record<string, Record<string, string>>;
  defaultLocale?: string;
  userRole?: string;
}

export default function RouteEditor({ initialData, cdnUrl, tagTranslations = {}, defaultLocale = 'en', userRole }: Props) {
  const [name, setName] = useState(initialData.name);
  const [tagline, setTagline] = useState(initialData.tagline);
  const [tags, setTags] = useState(initialData.tags);
  const [contentHash, setContentHash] = useState(initialData.contentHash);
  const [tagInput, setTagInput] = useState('');
  const [status, setStatus] = useState(initialData.status);
  const [body, setBody] = useState(initialData.body);
  const [media, setMedia] = useState<MediaItem[]>(initialData.media);
  const [variants, setVariants] = useState<VariantItem[]>(initialData.variants || []);

  const [activeLocale, setActiveLocale] = useState(defaultLocale);
  const [translations, setTranslations] = useState<Record<string, { name: string; tagline: string; body: string }>>(
    Object.fromEntries(
      Object.entries(initialData.translations || {}).map(([locale, t]) => [
        locale,
        { name: t.name || '', tagline: t.tagline || '', body: t.body || '' },
      ])
    )
  );

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (bodyRef.current && !bodyRef.current.value) {
      bodyRef.current.value = getField('body');
    }
  }, [activeLocale]);

  const [dragging, setDragging] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingGpxFiles, setPendingGpxFiles] = useState<File[]>([]);
  const dragCounterRef = useRef(0);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [githubUrl, setGithubUrl] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    function handleDragEnter(e: DragEvent) {
      e.preventDefault();
      dragCounterRef.current++;
      if (e.dataTransfer?.types.includes('Files')) {
        setDragging(true);
      }
    }
    function handleDragLeave(e: DragEvent) {
      e.preventDefault();
      dragCounterRef.current--;
      if (dragCounterRef.current === 0) {
        setDragging(false);
      }
    }
    function handleDragOver(e: DragEvent) {
      e.preventDefault();
    }
    function handleDrop(e: DragEvent) {
      e.preventDefault();
      dragCounterRef.current = 0;
      setDragging(false);
      const files = e.dataTransfer?.files;
      if (files?.length) {
        const allFiles = Array.from(files);
        const imageFiles = allFiles.filter(f => f.type.startsWith('image/'));
        const gpxFiles = allFiles.filter(f => f.name.toLowerCase().endsWith('.gpx'));
        if (imageFiles.length > 0) setPendingFiles(imageFiles);
        if (gpxFiles.length > 0) setPendingGpxFiles(gpxFiles);
      }
    }
    document.addEventListener('dragenter', handleDragEnter);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDrop);
    return () => {
      document.removeEventListener('dragenter', handleDragEnter);
      document.removeEventListener('dragleave', handleDragLeave);
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('drop', handleDrop);
    };
  }, []);

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

  function localeLabel(locale: string): string {
    try {
      const display = new Intl.DisplayNames([locale], { type: 'language' });
      const name = display.of(locale);
      return name ? name.charAt(0).toUpperCase() + name.slice(1) : locale;
    } catch {
      return locale;
    }
  }

  function displayTag(tag: string): string {
    if (activeLocale === defaultLocale) return tag;
    return tagTranslations[tag]?.[activeLocale] ?? tag;
  }

  function addTag() {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !tags.includes(tag)) {
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

  async function handleSave() {
    setError('');
    setGithubUrl('');

    if (!name.trim()) {
      setError('Name is required');
      document.getElementById('route-name')?.focus();
      return;
    }

    setSaving(true);
    setSaved(false);

    try {
      const res = await fetch(`/api/routes/${initialData.slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frontmatter: {
            name,
            tagline,
            tags,
            status,
          },
          body,
          media,
          variants,
          contentHash,
          translations,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        if (res.status === 409 && data.conflict) {
          setError(data.error);
          setGithubUrl(data.githubUrl);
          return;
        }
        throw new Error(data.error || 'Save failed');
      }

      const data = await res.json();
      if (data.contentHash) {
        setContentHash(data.contentHash);
      }

      if (initialData.isNew) {
        window.location.href = `/admin/routes/${initialData.slug}`;
        return;
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 8000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="route-editor">
      {dragging && (
        <div class="drop-overlay">
          <div class="drop-overlay-content">Drop photos or GPX files to add to route</div>
        </div>
      )}
      <section class="editor-section">
        <h2>Text</h2>
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
                value={tagInput}
                onInput={(e) => setTagInput((e.target as HTMLInputElement).value)}
                onKeyDown={handleTagKeyDown}
                onBlur={addTag}
                placeholder="Add tag..."
              />
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
            <textarea
              key={`body-${activeLocale}`}
              ref={bodyRef}
              id="route-body"
              value={getField('body')}
              onInput={(e) => setField('body', (e.target as HTMLTextAreaElement).value)}
              rows={12}
            />
          </div>
        </div>
      </section>

      <section class="editor-section">
        <h2>Photos</h2>
        <MediaManager
          media={media}
          onChange={setMedia}
          cdnUrl={cdnUrl}
          pendingFiles={pendingFiles}
          onPendingProcessed={() => setPendingFiles([])}
        />
      </section>

      <section class="editor-section">
        <h2>Variants</h2>
        <VariantManager
          variants={variants}
          onChange={setVariants}
          pendingFiles={pendingGpxFiles}
          onPendingProcessed={() => setPendingGpxFiles([])}
        />
      </section>

      <div class="editor-actions">
        {error && !githubUrl && (
          <div class="auth-error">{error}</div>
        )}
        {githubUrl && (
          <div class="conflict-notice">
            <strong>Save blocked — this route was changed on GitHub</strong>
            <p>
              Someone (or an automated process) modified this route's files on GitHub
              since you started editing. Your changes are still in the form above — nothing was lost.
            </p>
            <p><strong>To resolve this:</strong></p>
            <ol>
              <li>Open the file on GitHub to see what changed</li>
              <li>Copy your edits from the form above (they're safe until you navigate away)</li>
              <li>Either apply your changes directly on GitHub, or wait for the site to rebuild, then reload this page and re-enter your edits</li>
            </ol>
            <a href={githubUrl} target="_blank" rel="noopener" class="btn-primary" style="display: inline-block; margin-top: 0.5rem; text-decoration: none;">
              View file on GitHub
            </a>
          </div>
        )}
        {saved && (
          <div class="save-success">
            Saved! Your edit will be live in a few minutes.
            {' '}<a href={`/routes/${initialData.slug}`}>View live</a>
          </div>
        )}
        <button
          type="button"
          class="btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}
