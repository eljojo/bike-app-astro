import { buildMediaThumbnailUrl } from '../../lib/media/image-service';
import type { MediaThumbnailConfig } from '../../lib/media/image-service';
import { categoryEmoji } from '../../lib/geo/place-categories';

interface SocialLink {
  platform: string;
  url: string;
}

interface Props {
  name: string;
  category: string;
  vibe: string;
  lat: number;
  lng: number;
  address: string;
  website: string;
  phone: string;
  goodFor: string[];
  photoKey: string;
  socialLinks: SocialLink[];
  cdnUrl: string;
}

export default function PlacePreview({
  name, category, vibe, lat, lng, address, website, phone,
  goodFor, photoKey, socialLinks, cdnUrl,
}: Props) {
  const thumbConfig: MediaThumbnailConfig = { cdnUrl };

  function photoUrl(width: number) {
    if (!photoKey) return '';
    return buildMediaThumbnailUrl({ key: photoKey }, thumbConfig, { width, format: 'auto' });
  }

  // Resolve phone/website from social_links, falling back to legacy fields
  const resolvedPhone = socialLinks.find(l => l.platform === 'telephone')?.url || phone;
  const resolvedWebsite = socialLinks.find(l => l.platform === 'website')?.url || website;

  const emoji = categoryEmoji[category] || '';
  const categoryLabel = `${emoji} ${category.replace(/-/g, ' ')}`.trim();

  const facts: Array<[string, string]> = [];
  if (address) facts.push(['Address', address]);
  if (resolvedPhone) facts.push(['Phone', resolvedPhone]);
  if (resolvedWebsite) facts.push(['Website', resolvedWebsite]);

  return (
    <div class="editor-preview-pane">
      {photoKey && (
        <img
          class="editor-preview-photo"
          src={photoUrl(830)}
          srcset={`${photoUrl(1660)} 2x`}
          alt={name}
        />
      )}

      <h1 class="editor-preview-title">{name || 'Untitled Place'}</h1>

      {categoryLabel && (
        <p class="editor-preview-subtitle">{categoryLabel}</p>
      )}

      {vibe && (
        <p class="editor-preview-subtitle">{vibe}</p>
      )}

      {facts.length > 0 && (
        <table class="editor-preview-facts">
          <tbody>
            {facts.map(([label, value]) => (
              <tr key={label}>
                <td>{label}</td>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {goodFor.length > 0 && (
        <div class="editor-preview-tags">
          {goodFor.map(tag => <span key={tag} class="tag">{tag.replace(/-/g, ' ')}</span>)}
        </div>
      )}

      {(lat !== 0 || lng !== 0) && (
        <div class="editor-preview-meta">
          {lat.toFixed(6)}, {lng.toFixed(6)}
        </div>
      )}
    </div>
  );
}
