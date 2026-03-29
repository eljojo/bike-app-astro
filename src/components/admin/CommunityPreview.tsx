import { useMemo } from 'preact/hooks';
import { marked } from 'marked';
import { buildMediaThumbnailUrl } from '../../lib/media/image-service';
import type { MediaThumbnailConfig } from '../../lib/media/image-service';

interface SocialLink {
  platform: string;
  url: string;
}

interface Props {
  name: string;
  tagline: string;
  body: string;
  tags: string[];
  photoKey: string;
  socialLinks: SocialLink[];
  cdnUrl: string;
  displayTag?: (tag: string) => string;
}

export default function CommunityPreview({
  name, tagline, body, tags, photoKey, socialLinks, cdnUrl,
  displayTag = (t) => t,
}: Props) {
  const thumbConfig: MediaThumbnailConfig = { cdnUrl };

  const renderedBody = useMemo(() => {
    if (!body) return '';
    try {
      return marked.parse(body, { async: false }) as string;
    } catch {
      return '<p>Preview unavailable</p>';
    }
  }, [body]);

  function photoUrl(width: number) {
    if (!photoKey) return '';
    return buildMediaThumbnailUrl({ key: photoKey }, thumbConfig, { width, format: 'auto' });
  }

  const activeSocialLinks = socialLinks.filter(l => l.url.trim());

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

      <h1 class="editor-preview-title">{name || 'Untitled Community'}</h1>

      {tagline && (
        <p class="editor-preview-subtitle">{tagline}</p>
      )}

      {tags.length > 0 && (
        <div class="editor-preview-tags">
          {tags.map(tag => <span key={tag} class="tag">{displayTag(tag)}</span>)}
        </div>
      )}

      {renderedBody && (
        <div class="editor-preview-body" dangerouslySetInnerHTML={{ __html: renderedBody }} />
      )}

      {activeSocialLinks.length > 0 && (
        <div class="editor-preview-links">
          {activeSocialLinks.map((link, i) => (
            <a key={i} href={link.url} target="_blank" rel="noopener noreferrer">
              {link.platform.charAt(0).toUpperCase() + link.platform.slice(1)}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
