import { useState } from 'preact/hooks';
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
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
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        if (res.status === 409) {
          throw new Error(data.error || 'Conflict: route was modified externally. Please reload the page.');
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
                  <button type="button" onClick={() => removeTag(tag)}>\u00d7</button>
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
        {error && <div class="auth-error">{error}</div>}
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
