// AGENTS.md: See src/components/admin/AGENTS.md for editor rules.
// Key: all styles in admin.scss (scoped CSS does not reach Preact islands).
import { useState } from 'preact/hooks';
import { slugify } from '../../lib/slug';

interface SlugEditorProps {
  slug: string;
  onSlugChange: (slug: string) => void;
  prefix: string;
  canEdit?: boolean;
}

export default function SlugEditor({ slug, onSlugChange, prefix, canEdit = true }: SlugEditorProps) {
  const [editing, setEditing] = useState(false);

  if (!canEdit) return null;

  return editing ? (
    <div class="editor-slug-edit">
      <span class="editor-slug-prefix">{prefix}</span>
      <input
        type="text"
        value={slug}
        onInput={(e) => onSlugChange(slugify((e.target as HTMLInputElement).value))}
        class="editor-slug-input"
      />
      <button type="button" class="btn-small" onClick={() => setEditing(false)}>Done</button>
    </div>
  ) : (
    <span class="editor-slug-toggle" role="button" tabIndex={0} onClick={() => setEditing(true)} onKeyDown={(e) => { if (e.key === 'Enter') setEditing(true); }}>
      <span class="editor-slug-origin">{typeof window !== 'undefined' ? window.location.origin : ''}</span>{prefix}{slug}
    </span>
  );
}
