// AGENTS.md: See src/components/admin/AGENTS.md for editor rules.
// Key: textarea hydration workaround required, contentHash must sync after save, all styles in admin.scss.
import { useState } from 'preact/hooks';
import { useEditorForm } from './useEditorForm';
import EditorLayout from './EditorLayout';
import { bindText, bindCheckbox, bindTextarea } from './field-helpers';
import PhotoField from './PhotoField';
import TagEditor from './TagEditor';
import { localeLabel } from '../../lib/i18n/locale-utils';
import BikePathPreview from './BikePathPreview';
import type { BikePathDetail } from '../../lib/models/bike-path-model';

interface Props {
  initialData: BikePathDetail & { contentHash?: string };
  userRole?: string;
  cdnUrl?: string;
  knownTags?: string[];
  secondaryLocales?: string[];
}

export default function BikePathEditor({ initialData, userRole, cdnUrl = '', knownTags = [], secondaryLocales }: Props) {
  const [name, setName] = useState(initialData.name ?? '');
  const locales = secondaryLocales || [];
  const [translations, setTranslations] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const locale of locales) {
      const key = `name_${locale}`;
      initial[locale] = (initialData as Record<string, unknown>)[key] as string || '';
    }
    return initial;
  });
  function setTranslation(locale: string, value: string) {
    setTranslations(prev => ({ ...prev, [locale]: value }));
  }
  const [vibe, setVibe] = useState(initialData.vibe ?? '');
  const [hidden, setHidden] = useState(initialData.hidden);
  const [stub, setStub] = useState(initialData.stub ?? false);
  const [featured, setFeatured] = useState(initialData.featured ?? false);
  const [photoKey, setPhotoKey] = useState(initialData.photo_key ?? '');
  const [tags, setTags] = useState<string[]>(initialData.tags || []);
  const [wikipedia, setWikipedia] = useState(initialData.wikipedia ?? '');
  const [operator, setOperator] = useState(initialData.operator ?? '');
  const [body, setBody] = useState(initialData.body);

  const editor = useEditorForm({
    apiBase: '/api/bike-paths',
    contentId: initialData.id,
    contentHash: initialData.contentHash,
    userRole,
    initialBody: initialData.body,
    deps: [name, translations, vibe, hidden, stub, featured, photoKey, tags, wikipedia, operator, body],
    buildPayload: () => ({
      frontmatter: {
        ...(name && { name }),
        ...Object.fromEntries(
          locales
            .filter(locale => translations[locale])
            .map(locale => [`name_${locale}`, translations[locale]])
        ),
        ...(vibe && { vibe }),
        hidden,
        stub,
        featured,
        includes: initialData.includes, // read-only, pass through
        ...(photoKey && { photo_key: photoKey }),
        tags,
        ...(wikipedia && { wikipedia }),
        ...(operator && { operator }),
      },
      body,
    }),
  });

  return (
    <EditorLayout
      editor={editor}
      className="bike-path-editor"
      contentType="bike path"
      userRole={userRole}
      viewLink="/admin/bike-paths"
      preview={
        <BikePathPreview
          name={name}
          vibe={vibe}
          body={body}
          tags={tags}
          operator={operator}
          wikipedia={wikipedia}
          photoKey={photoKey}
          cdnUrl={cdnUrl}
        />
      }
    >
        <div class="form-field">
          <label for="bp-name">Name</label>
          <input id="bp-name" type="text" {...bindText(name, setName)}
            placeholder={initialData.id} />
        </div>

        {locales.map(locale => (
          <div class="form-field" key={locale}>
            <label for={`bp-name-${locale}`}>Name ({localeLabel(locale)})</label>
            <input id={`bp-name-${locale}`} type="text" value={translations[locale] || ''}
              onInput={e => setTranslation(locale, (e.target as HTMLInputElement).value)} />
          </div>
        ))}

        <div class="form-field">
          <label for="bp-vibe">Vibe <span class="field-hint">(one-sentence hook)</span></label>
          <input id="bp-vibe" type="text" {...bindText(vibe, setVibe)}
            placeholder="One-liner description" />
        </div>

        <div class="form-field">
          <label for="bp-body">Description</label>
          <textarea id="bp-body" ref={editor.bodyRef} rows={10} {...bindTextarea(body, setBody)} />
        </div>

        <div class="form-field">
          <label>Tags</label>
          <TagEditor
            tags={tags}
            onTagsChange={setTags}
            knownTags={knownTags}
            datalistId="bp-tag-suggestions"
          />
        </div>

        <div class="form-field">
          <label for="bp-wikipedia">Wikipedia <span class="field-hint">(en:Article Title or fr:Titre)</span></label>
          <input id="bp-wikipedia" type="text" {...bindText(wikipedia, setWikipedia)}
            placeholder="en:Capital Pathway" />
        </div>

        <div class="form-field">
          <label for="bp-operator">Operator <span class="field-hint">(overrides YML value)</span></label>
          <input id="bp-operator" type="text" {...bindText(operator, setOperator)}
            placeholder="NCC" />
        </div>

        <PhotoField
          photoKey={photoKey}
          cdnUrl={cdnUrl}
          onPhotoChange={(key) => setPhotoKey(key)}
          label="Hero Photo"
        />

        <div class="form-field form-field--inline">
          <label>
            <input type="checkbox" {...bindCheckbox(featured, setFeatured)} />
            {' '}Featured (show on the paths index page)
          </label>
        </div>

        <div class="form-field form-field--inline">
          <label>
            <input type="checkbox" {...bindCheckbox(stub, setStub)} />
            {' '}Stub (needs more information — shows a CTA inviting people to edit)
          </label>
        </div>

        <div class="form-field form-field--inline">
          <label>
            <input type="checkbox" {...bindCheckbox(hidden, setHidden)} />
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
    </EditorLayout>
  );
}
