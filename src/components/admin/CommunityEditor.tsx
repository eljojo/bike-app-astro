// AGENTS.md: See src/components/admin/AGENTS.md for editor rules.
// Key: textarea hydration workaround required, contentHash must sync after save, all styles in admin.scss.
import { useState } from 'preact/hooks';
import { useEditorForm } from './useEditorForm';
import { useFormValidation } from './useFormValidation';
import EditorLayout from './EditorLayout';
import { bindText, bindCheckbox, bindTextarea } from './field-helpers';
import PhotoField from './PhotoField';
import CoverPhotoField, { type CoverItem } from './CoverPhotoField';
import TagEditor from './TagEditor';
import CommunityPreview from './CommunityPreview';
import type { OrganizerDetail } from '../../lib/models/organizer-model';
import type { OrganizerUpdate } from '../../views/api/organizer-save';
import { SOCIAL_PLATFORMS, type SocialLink } from '@/lib/social-links';

type EditorMediaItem = NonNullable<OrganizerDetail['media']>[number];

interface Props {
  initialData: Partial<OrganizerDetail> & { contentHash?: string; isNew?: boolean };
  cdnUrl: string;
  videosCdnUrl?: string;
  videoPrefix?: string;
  tagTranslations?: Record<string, Record<string, string>>;
  knownTags?: string[];
  defaultLocale?: string;
  userRole?: string;
  guestLabel?: string;
  locations?: Array<{ slug: string; name: string; address?: string }>;
}

// eslint-disable-next-line bike-app/no-hardcoded-city-locale -- fallback default for prop
export default function CommunityEditor({ initialData, cdnUrl, tagTranslations = {}, knownTags = [], defaultLocale = 'en', userRole, guestLabel, locations }: Props) {
  const [name, setName] = useState(initialData.name || '');
  const [tagline, setTagline] = useState(initialData.tagline || '');
  const [body, setBody] = useState(initialData.body || '');
  const [tags, setTags] = useState<string[]>(initialData.tags || []);
  const [featured, setFeatured] = useState(initialData.featured || false);
  const [hidden, setHidden] = useState(initialData.hidden || false);
  const [photoKey, setPhotoKey] = useState(initialData.photo_key || '');
  const [photoContentType, setPhotoContentType] = useState(initialData.photo_content_type || '');
  const [photoWidth, setPhotoWidth] = useState(initialData.photo_width || 0);
  const [photoHeight, setPhotoHeight] = useState(initialData.photo_height || 0);
  const [socialLinks, setSocialLinks] = useState<SocialLink[]>(
    initialData.social_links?.length ? initialData.social_links : [],
  );
  const [icsUrl, setIcsUrl] = useState(initialData.ics_url || '');
  const [media, setMedia] = useState<EditorMediaItem[]>(initialData.media ?? []);

  const cover = media.find(m => m.cover) as CoverItem | undefined;

  function handleCoverChange(newCover: CoverItem | undefined) {
    setMedia(prev => {
      const withoutCover = prev.filter(m => !m.cover);
      return newCover ? [...withoutCover, newCover as EditorMediaItem] : withoutCover;
    });
  }

  const { validate } = useFormValidation([
    { field: 'community-name', check: () => !name.trim(), message: 'Name is required' },
  ]);

  const editor = useEditorForm({
    apiBase: '/api/organizers',
    contentId: initialData.isNew ? null : (initialData.slug || null),
    contentHash: initialData.contentHash,
    userRole,
    validate,
    initialBody: initialData.body || '',
    deps: [name, tagline, body, tags, featured, hidden, photoKey, socialLinks, icsUrl, media],
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
          media: media.map(m => {
            const { cover, ...rest } = m;
            return cover ? { ...rest, cover: true as const } : rest;
          }),
          ...(icsUrl && { ics_url: icsUrl }),
        },
        body,
      };
      return payload as unknown as Record<string, unknown>;
    },
    onSuccess: (result) => {
      if (initialData.isNew && result.id) {
        window.location.href = `/admin/communities/${result.id}`;
      }
    },
  });

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

  function displayTag(tag: string): string {
    return tagTranslations[tag]?.[defaultLocale] ?? tag;
  }

  return (
    <EditorLayout
      editor={editor}
      className="community-editor"
      contentType="community"
      userRole={userRole}
      guestLabel={guestLabel}
      viewLink="/admin/communities"
      preview={
        <CommunityPreview
          name={name}
          tagline={tagline}
          body={body}
          tags={tags}
          photoKey={photoKey}
          media={media}
          socialLinks={socialLinks}
          cdnUrl={cdnUrl}
          displayTag={displayTag}
        />
      }
    >
        <div class="form-field">
          <label for="community-name">Name</label>
          <input id="community-name" type="text" {...bindText(name, setName)} />
        </div>

        <div class="form-field">
          <label for="community-tagline">Tagline</label>
          <input id="community-tagline" type="text"
            placeholder="A short description"
            {...bindText(tagline, setTagline)} />
        </div>

        <div class="form-field">
          <label for="community-body">Bio</label>
          <textarea
            id="community-body"
            ref={editor.bodyRef}
            rows={6}
            {...bindTextarea(body, setBody)}
          />
        </div>

        <div class="form-field">
          <label>Tags</label>
          <TagEditor
            tags={tags}
            onTagsChange={setTags}
            knownTags={knownTags}
            tagTranslations={tagTranslations}
            activeLocale={defaultLocale}
            datalistId="community-tag-suggestions"
          />
        </div>

        {userRole === 'admin' && (
          <div class="form-field">
            <label class="checkbox-label">
              <input type="checkbox" {...bindCheckbox(featured, setFeatured)} />
              Featured community
            </label>
            <label class="checkbox-label">
              <input type="checkbox" {...bindCheckbox(hidden, setHidden)} />
              Hide from public pages
            </label>
          </div>
        )}

        <PhotoField
          photoKey={photoKey}
          cdnUrl={cdnUrl}
          label="Profile photo"
          onPhotoChange={(key, contentType, width, height) => {
            setPhotoKey(key);
            setPhotoContentType(contentType);
            setPhotoWidth(width || 0);
            setPhotoHeight(height || 0);
          }}
        />

        <CoverPhotoField
          cover={cover}
          cdnUrl={cdnUrl}
          onCoverChange={handleCoverChange}
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

        {userRole === 'admin' && (
          <div class="form-field">
            <label for="community-ics-url">ICS calendar URL</label>
            <input id="community-ics-url" type="text"
              placeholder="https://..."
              {...bindText(icsUrl, setIcsUrl)} />
            <p class="field-hint-block">Public ICS/iCal feed URL for this community's calendar. Admin-only: the value is used to generate event suggestions for admins.</p>
          </div>
        )}

        {tags.includes('bike-shop') && locations && (
          <div class="form-field">
            <label>Locations</label>
            <div class="community-locations-panel">
              {locations.length === 0 && <p class="text-muted">No locations linked. Add this organizer to places via the place editor.</p>}
              {locations.map(loc => (
                <div key={loc.slug} class="community-location-row">
                  <a href={`/admin/places/${loc.slug}`}>{loc.name}</a>
                  {loc.address && <span class="text-muted"> — {loc.address}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
    </EditorLayout>
  );
}
