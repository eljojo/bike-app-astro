import { useMemo } from 'preact/hooks';
import { marked } from 'marked';
import type { MediaItem } from './MediaManager';
import { buildMediaThumbnailUrl } from '../../lib/media/image-service';
import type { MediaThumbnailConfig } from '../../lib/media/image-service';

interface Props {
  name: string;
  tagline: string;
  tags: string[];
  body: string;
  media: MediaItem[];
  cdnUrl: string;
  videosCdnUrl?: string;
  videoPrefix?: string;
  displayTag?: (tag: string) => string;
}

export default function RoutePreview({
  name, tagline, tags, body, media, cdnUrl, videosCdnUrl, videoPrefix,
  displayTag = (t) => t,
}: Props) {
  const thumbConfig: MediaThumbnailConfig = { cdnUrl, videosCdnUrl, videoPrefix };
  const renderedBody = useMemo(() => {
    if (!body) return '';
    try {
      return marked.parse(body, { async: false }) as string;
    } catch {
      return '<p>Preview unavailable</p>';
    }
  }, [body]);

  const cover = media.find(m => m.cover) || media[0];
  const photos = media;

  function imageUrl(item: { key: string; type?: string }, opts?: { width?: number }) {
    const w = opts?.width || 400;
    return buildMediaThumbnailUrl(item, thumbConfig, { width: w, format: 'auto' });
  }

  return (
    <div class="route-preview">
      <div class="route-preview-content">
        {cover && (
          <div class="route-preview-hero">
            <img
              src={imageUrl(cover, { width: 830 })}
              srcset={`${imageUrl(cover, { width: 1660 })} 2x`}
              alt={name}
            />
          </div>
        )}

        <h1 class="route-preview-title">{name || 'Untitled Route'}</h1>
        {tagline && <p class="route-preview-tagline">{tagline}</p>}

        {tags.length > 0 && (
          <ul class="route-preview-tags">
            {tags.map(tag => <li key={tag} class="tag-pill">{displayTag(tag)}</li>)}
          </ul>
        )}

        {renderedBody && (
          <div class="route-preview-body" dangerouslySetInnerHTML={{ __html: renderedBody }} />
        )}

        {photos.length > 0 && (
          <div class="route-preview-gallery">
            {photos.map((photo) => (
              <img key={photo.key} src={imageUrl(photo, { width: 200 })} alt={photo.caption || ''} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
