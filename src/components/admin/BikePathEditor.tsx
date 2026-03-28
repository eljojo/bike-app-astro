// AGENTS.md: See src/components/admin/AGENTS.md for editor rules.
// Key: textarea hydration workaround required, contentHash must sync after save, all styles in admin.scss.
import { useState, useRef, useEffect } from 'preact/hooks';
import { useHydrated, useTextareaValue } from '../../lib/hooks';
import { useEditorState } from './useEditorState';
import { useUnsavedGuard } from '../../lib/hooks/use-unsaved-guard';
import EditorActions from './EditorActions';
import type { BikePathDetail } from '../../lib/models/bike-path-model';

interface Props {
  initialData: BikePathDetail & { contentHash?: string };
  userRole?: string;
}

export default function BikePathEditor({ initialData, userRole }: Props) {
  const hydratedRef = useHydrated<HTMLDivElement>();
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty);

  const [name, setName] = useState(initialData.name ?? '');
  const [nameFr, setNameFr] = useState(initialData.name_fr ?? '');
  const [vibe, setVibe] = useState(initialData.vibe ?? '');
  const [hidden, setHidden] = useState(initialData.hidden);
  const [photoKey, setPhotoKey] = useState(initialData.photo_key ?? '');
  const [tags, setTags] = useState(initialData.tags.join(', '));
  const [body, setBody] = useState(initialData.body);

  // Textarea hydration bug fix
  const bodyRef = useTextareaValue(initialData.body);

  // Track dirty state
  const initialRender = useRef(true);
  useEffect(() => {
    if (initialRender.current) { initialRender.current = false; return; }
    setDirty(true);
  }, [name, nameFr, vibe, hidden, photoKey, tags, body]);

  const { saving, saved, error, githubUrl, save: handleSave, dismissSaved } = useEditorState({
    apiBase: '/api/bike-paths',
    contentId: initialData.id,
    initialContentHash: initialData.contentHash,
    userRole,
    buildPayload: () => ({
      frontmatter: {
        ...(name && { name }),
        ...(nameFr && { name_fr: nameFr }),
        ...(vibe && { vibe }),
        hidden,
        includes: initialData.includes, // read-only, pass through
        ...(photoKey && { photo_key: photoKey }),
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      },
      body,
    }),
    onSuccess: () => {
      setDirty(false);
    },
  });

  return (
    <div class="bike-path-editor" ref={hydratedRef}>
      <div class="auth-form">
        <div class="form-field">
          <label for="bp-name">Name</label>
          <input id="bp-name" type="text" value={name}
            onInput={e => setName((e.target as HTMLInputElement).value)}
            placeholder={initialData.id} />
        </div>

        <div class="form-field">
          <label for="bp-name-fr">Name (French)</label>
          <input id="bp-name-fr" type="text" value={nameFr}
            onInput={e => setNameFr((e.target as HTMLInputElement).value)} />
        </div>

        <div class="form-field">
          <label for="bp-vibe">Vibe <span class="field-hint">(one-sentence hook)</span></label>
          <input id="bp-vibe" type="text" value={vibe}
            onInput={e => setVibe((e.target as HTMLInputElement).value)}
            placeholder="One-liner description" />
        </div>

        <div class="form-field">
          <label for="bp-body">Description</label>
          <textarea id="bp-body" ref={bodyRef} rows={10} value={body}
            onInput={e => setBody((e.target as HTMLTextAreaElement).value)} />
        </div>

        <div class="form-field">
          <label for="bp-tags">Tags</label>
          <input id="bp-tags" type="text" value={tags}
            onInput={e => setTags((e.target as HTMLInputElement).value)}
            placeholder="comma, separated, tags" />
        </div>

        <div class="form-field">
          <label for="bp-photo-key">Photo key</label>
          <input id="bp-photo-key" type="text" value={photoKey}
            onInput={e => setPhotoKey((e.target as HTMLInputElement).value)} />
        </div>

        <div class="form-field form-field--inline">
          <label>
            <input type="checkbox" checked={hidden}
              onChange={e => setHidden((e.target as HTMLInputElement).checked)} />
            {' '}Hidden (suppress page generation)
          </label>
        </div>

        {initialData.includes.length > 0 && (
          <div class="form-field">
            <label>Includes (read-only)</label>
            <ul class="bp-includes-list">
              {initialData.includes.map(slug => <li key={slug}><code>{slug}</code></li>)}
            </ul>
          </div>
        )}
      </div>

      <EditorActions
        error={error} githubUrl={githubUrl} saved={saved} saving={saving}
        onSave={handleSave} onDismiss={dismissSaved} contentType="bike path" userRole={userRole}
        viewLink="/admin/paths"
        licenseDocsUrl="https://whereto.bike/about/licensing/"
      />
    </div>
  );
}
