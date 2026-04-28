import { useMemo } from 'preact/hooks';
import { marked } from 'marked';
import { buildMediaThumbnailUrl } from '../../lib/media/image-service';
import type { MediaThumbnailConfig } from '../../lib/media/image-service';

interface SocialLink {
  platform: string;
  url: string;
}

interface PreviewMediaItem {
  key: string;
  type?: string;
  caption?: string;
  width?: number;
  height?: number;
  cover?: boolean;
}

interface Props {
  name: string;
  tagline: string;
  body: string;
  tags: string[];
  photoKey: string;
  media?: PreviewMediaItem[];
  socialLinks: SocialLink[];
  cdnUrl: string;
  displayTag?: (tag: string) => string;
}

export default function CommunityPreview({
  name, tagline, body, tags, photoKey, media = [], socialLinks, cdnUrl,
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

  const cover = media.find(m => m.cover);
  const hasCover = !!cover;

  function thumbUrl(key: string, width: number) {
    return buildMediaThumbnailUrl({ key }, thumbConfig, { width, format: 'auto' });
  }

  const activeSocialLinks = socialLinks.filter(l => l.url.trim());

  return (
    <div class={`editor-preview-pane${hasCover ? ' editor-preview-pane--has-cover' : ''}`}>
      {hasCover && cover && (
        <img
          class="editor-preview-cover"
          src={thumbUrl(cover.key, 830)}
          srcset={`${thumbUrl(cover.key, 1660)} 2x`}
          alt={cover.caption || name}
        />
      )}

      <div class="editor-preview-header">
        {photoKey ? (
          <img
            class="editor-preview-avatar"
            src={thumbUrl(photoKey, 224)}
            alt={name}
          />
        ) : (
          <div class="editor-preview-avatar editor-preview-avatar--initials">
            {name ? name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') : '?'}
          </div>
        )}
        <div class="editor-preview-header-info">
          <h1 class="editor-preview-title">{name || 'Untitled Community'}</h1>
          {tagline && <p class="editor-preview-subtitle">{tagline}</p>}
        </div>
      </div>

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
