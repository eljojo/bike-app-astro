import { useState } from 'preact/hooks';
import { useTextareaValue } from '../../lib/hooks';
import MediaManager from './MediaManager';
import type { MediaItem } from './MediaManager';
import VariantManager from './VariantManager';
import type { VariantItem } from './VariantManager';

interface RouteData {
  slug: string;
  name: string;
  tagline: string;
  tags: string[];
  status: string;
  body: string;
  media: MediaItem[];
  contentHash?: string;
  variants?: VariantItem[];
  isNew?: boolean;
}

interface Props {
  initialData: RouteData;
  cdnUrl: string;
  isDraft?: boolean;
  draftPrNumber?: number | null;
}

export default function RouteEditor({ initialData, cdnUrl, isDraft, draftPrNumber }: Props) {
  const [name, setName] = useState(initialData.name);
  const [tagline, setTagline] = useState(initialData.tagline);
  const [tags, setTags] = useState(initialData.tags);
  const [contentHash, setContentHash] = useState(initialData.contentHash);
  const [tagInput, setTagInput] = useState('');
  const [status, setStatus] = useState(initialData.status);
  const [body, setBody] = useState(initialData.body);
  const [media, setMedia] = useState<MediaItem[]>(initialData.media);
  const [variants, setVariants] = useState<VariantItem[]>(initialData.variants || []);
  const bodyRef = useTextareaValue(body);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [githubUrl, setGithubUrl] = useState('');
  const [saved, setSaved] = useState(false);

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
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDiscard() {
    if (!confirm('Discard all your changes to this route? This cannot be undone.')) return;
    const res = await fetch('/api/drafts/discard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType: 'routes', contentSlug: initialData.slug }),
    });
    if (res.ok) {
      window.location.reload();
    }
  }

  return (
    <div class="route-editor">
      {isDraft && (
        <div class="draft-banner">
          <span>
            Draft — pending review
            {draftPrNumber && (
              <> (<a href={`https://github.com/eljojo/bike-routes/pull/${draftPrNumber}`} target="_blank" rel="noopener">PR #{draftPrNumber}</a>)</>
            )}
          </span>
          <button type="button" class="btn-discard" onClick={handleDiscard}>
            Discard changes
          </button>
        </div>
      )}
      <section class="editor-section">
        <h2>Text</h2>
        <div class="auth-form">
          <div class="form-field">
            <label for="route-name">Name</label>
            <input
              id="route-name"
              type="text"
              value={name}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
            />
          </div>

          <div class="form-field">
            <label for="route-tagline">Tagline</label>
            <input
              id="route-tagline"
              type="text"
              value={tagline}
              onInput={(e) => setTagline((e.target as HTMLInputElement).value)}
            />
          </div>

          <div class="form-field">
            <label>Tags</label>
            <div class="tag-editor">
              {tags.map((tag) => (
                <span key={tag} class="tag-pill">
                  {tag}
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

          <div class="form-field">
            <label for="route-body">Body (markdown)</label>
            <textarea
              id="route-body"
              ref={bodyRef}
              value={body}
              onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
              rows={12}
            />
          </div>
        </div>
      </section>

      <section class="editor-section">
        <h2>Photos</h2>
        <MediaManager media={media} onChange={setMedia} cdnUrl={cdnUrl} />
      </section>

      <section class="editor-section">
        <h2>Variants</h2>
        <VariantManager variants={variants} onChange={setVariants} />
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
        {saved && <div class="save-success">Saved! Site rebuild triggered.</div>}
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
