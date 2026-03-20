// AGENTS.md: See src/components/admin/AGENTS.md for editor rules.
// Key: textarea hydration workaround required, contentHash must sync after save, all styles in admin.scss.
import { useState, useRef, useEffect } from 'preact/hooks';
import { useHydrated } from '../../lib/hooks';
import { useEditorState } from './useEditorState';
import { useFormValidation } from './useFormValidation';
import { useUnsavedGuard } from '../../lib/hooks/use-unsaved-guard';
import PhotoField from './PhotoField';
import EditorActions from './EditorActions';
import type { OrganizerDetail } from '../../lib/models/organizer-model';
import type { OrganizerUpdate } from '../../views/api/organizer-save';

const SOCIAL_PLATFORMS = [
  'instagram', 'facebook', 'strava', 'youtube',
  'meetup', 'tiktok', 'bluesky', 'threads', 'website',
  'discord', 'google_form', 'linktree', 'rwgps', 'komoot', 'newsletter',
] as const;

interface SocialLink {
  platform: string;
  url: string;
}

interface Props {
  initialData: Partial<OrganizerDetail> & { contentHash?: string; isNew?: boolean };
  cdnUrl: string;
  videosCdnUrl?: string;
  videoPrefix?: string;
  tagTranslations?: Record<string, Record<string, string>>;
  knownTags?: string[];
  defaultLocale?: string;
  userRole?: string;
}

// eslint-disable-next-line bike-app/no-hardcoded-city-locale -- fallback default for prop
export default function CommunityEditor({ initialData, cdnUrl, tagTranslations = {}, knownTags = [], defaultLocale = 'en', userRole }: Props) {
  const hydratedRef = useHydrated<HTMLDivElement>();
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty);

  const [name, setName] = useState(initialData.name || '');
  const [tagline, setTagline] = useState(initialData.tagline || '');
  const [body, setBody] = useState(initialData.body || '');
  const [tags, setTags] = useState<string[]>(initialData.tags || []);
  const [tagInput, setTagInput] = useState('');
  const [featured, setFeatured] = useState(initialData.featured || false);
  const [hidden, setHidden] = useState(initialData.hidden || false);
  const [photoKey, setPhotoKey] = useState(initialData.photo_key || '');
  const [photoContentType, setPhotoContentType] = useState(initialData.photo_content_type || '');
  const [photoWidth, setPhotoWidth] = useState(initialData.photo_width || 0);
  const [photoHeight, setPhotoHeight] = useState(initialData.photo_height || 0);
  const [socialLinks, setSocialLinks] = useState<SocialLink[]>(
    initialData.social_links?.length ? initialData.social_links : [],
  );

  // Textarea hydration workaround
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (bodyRef.current && body && !bodyRef.current.value) {
      bodyRef.current.value = body;
    }
  }, []);

  const initialRender = useRef(true);
  useEffect(() => {
    if (initialRender.current) { initialRender.current = false; return; }
    setDirty(true);
  }, [name, tagline, body, tags, featured, hidden, photoKey, socialLinks]);

  const { validate } = useFormValidation([
    { field: 'community-name', check: () => !name.trim(), message: 'Name is required' },
  ]);

  const { saving, saved, error, githubUrl, save: handleSave } = useEditorState({
    apiBase: '/api/organizers',
    contentId: initialData.isNew ? null : (initialData.slug || null),
    initialContentHash: initialData.contentHash,
    userRole,
    validate,
    buildPayload: () => {
      const payload: OrganizerUpdate = {
        frontmatter: {
          name,
          ...(tagline && { tagline }),
          ...(tags.length && { tags }),
          ...(userRole === 'admin' && { featured, hidden }),
          ...(photoKey && {
            photo_key: photoKey,
            ...(photoContentType && { photo_content_type: photoContentType }),
            ...(photoWidth && { photo_width: photoWidth }),
            ...(photoHeight && { photo_height: photoHeight }),
          }),
          ...(socialLinks.length > 0 && {
            social_links: socialLinks.filter(l => l.url.trim()),
          }),
        },
        body,
      };
      return payload as unknown as Record<string, unknown>;
    },
    onSuccess: (result) => {
      setDirty(false);
      if (initialData.isNew && result.id) {
        window.location.href = `/admin/communities/${result.id}`;
      }
    },
  });

  function displayTag(tag: string): string {
    return tagTranslations[tag]?.[defaultLocale] ?? tag;
  }

  function resolveTag(input: string): string {
    if (knownTags.includes(input)) return input;
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

  function addSocialLink() {
    setSocialLinks(prev => [...prev, { platform: 'instagram', url: '' }]);
  }

  function removeSocialLink(index: number) {
    setSocialLinks(prev => prev.filter((_, i) => i !== index));
  }

  function updateSocialLink(index: number, field: 'platform' | 'url', value: string) {
    setSocialLinks(prev => prev.map((link, i) =>
      i === index ? { ...link, [field]: value } : link,
    ));
  }

  return (
    <div ref={hydratedRef} class="community-editor">
      <div class="auth-form">
        <div class="form-field">
          <label for="community-name">Name</label>
          <input id="community-name" type="text" value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </div>

        <div class="form-field">
          <label for="community-tagline">Tagline</label>
          <input id="community-tagline" type="text" value={tagline}
            placeholder="A short description"
            onInput={(e) => setTagline((e.target as HTMLInputElement).value)} />
        </div>

        <div class="form-field">
          <label for="community-body">Bio</label>
          <textarea
            id="community-body"
            ref={bodyRef}
            rows={6}
            onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
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
              list="community-tag-suggestions"
              value={tagInput}
              onInput={(e) => setTagInput((e.target as HTMLInputElement).value)}
              onKeyDown={handleTagKeyDown}
              onBlur={addTag}
              placeholder="Add tag..."
            />
            <datalist id="community-tag-suggestions">
              {knownTags
                .filter(t => !tags.includes(t))
                .flatMap(tag => {
                  const options = [<option key={tag} value={tag} />];
                  const locales = tagTranslations[tag];
                  if (locales) {
                    for (const [locale, translated] of Object.entries(locales)) {
                      options.push(<option key={`${tag}-${locale}`} value={translated} />);
                    }
                  }
                  return options;
                })}
            </datalist>
          </div>
        </div>

        {userRole === 'admin' && (
          <div class="form-field">
            <label class="checkbox-label">
              <input type="checkbox" checked={featured}
                onChange={(e) => setFeatured((e.target as HTMLInputElement).checked)} />
              Featured community
            </label>
            <label class="checkbox-label">
              <input type="checkbox" checked={hidden}
                onChange={(e) => setHidden((e.target as HTMLInputElement).checked)} />
              Hide from public pages
            </label>
          </div>
        )}

        <PhotoField
          photoKey={photoKey}
          cdnUrl={cdnUrl}
          label="Photo"
          onPhotoChange={(key, contentType, width, height) => {
            setPhotoKey(key);
            setPhotoContentType(contentType);
            setPhotoWidth(width || 0);
            setPhotoHeight(height || 0);
          }}
        />

        <div class="form-field">
          <label>Social links</label>
          {socialLinks.map((link, index) => (
            <div class="social-link-row" key={index}>
              <select
                value={link.platform}
                onChange={(e) => updateSocialLink(index, 'platform', (e.target as HTMLSelectElement).value)}
              >
                {SOCIAL_PLATFORMS.map(p => (
                  <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                ))}
              </select>
              <input
                type="url"
                value={link.url}
                placeholder="https://..."
                onInput={(e) => updateSocialLink(index, 'url', (e.target as HTMLInputElement).value)}
              />
              <button type="button" class="btn-remove-social" onClick={() => removeSocialLink(index)}>
                Remove
              </button>
            </div>
          ))}
          <button type="button" class="btn-secondary" onClick={addSocialLink}>
            + Add social link
          </button>
        </div>
      </div>

      <EditorActions
        error={error} githubUrl={githubUrl} saved={saved} saving={saving}
        onSave={handleSave} contentType="community" userRole={userRole}
        viewLink="/admin/communities"
        licenseDocsUrl="https://whereto.bike/about/licensing/"
      />
    </div>
  );
}
