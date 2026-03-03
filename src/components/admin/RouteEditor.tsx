import { useState, useEffect, useRef } from 'preact/hooks';
import MediaManager from './MediaManager';
import type { MediaItem } from './MediaManager';

interface RouteData {
  slug: string;
  name: string;
  tagline: string;
  tags: string[];
  distance: number;
  status: string;
  body: string;
  media: MediaItem[];
  contentHash?: string;
}

interface Props {
  initialData: RouteData;
  cdnUrl: string;
}

export default function RouteEditor({ initialData, cdnUrl }: Props) {
  const [name, setName] = useState(initialData.name);
  const [tagline, setTagline] = useState(initialData.tagline);
  const [tags, setTags] = useState(initialData.tags);
  const [tagInput, setTagInput] = useState('');
  const [distance, setDistance] = useState(initialData.distance);
  const [status, setStatus] = useState(initialData.status);
  const [body, setBody] = useState(initialData.body);
  const [media, setMedia] = useState<MediaItem[]>(initialData.media);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Preact hydration bug: the value prop is not applied to textareas during
  // hydration, and child diffing removes the SSR text content, leaving the
  // textarea empty. Re-apply the value after mount.
  useEffect(() => {
    if (bodyRef.current && body && !bodyRef.current.value) {
      bodyRef.current.value = body;
    }
  }, []);
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
            distance,
            status,
          },
          body,
          media,
          contentHash: initialData.contentHash,
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

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="route-editor">
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
            <label for="route-distance">Distance (km)</label>
            <input
              id="route-distance"
              type="number"
              value={distance}
              onInput={(e) => setDistance(parseFloat((e.target as HTMLInputElement).value) || 0)}
              step="0.1"
            />
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
