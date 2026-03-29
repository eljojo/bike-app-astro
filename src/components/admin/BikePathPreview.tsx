import { useMemo } from 'preact/hooks';
import { marked } from 'marked';
import { buildMediaThumbnailUrl } from '../../lib/media/image-service';
import type { MediaThumbnailConfig } from '../../lib/media/image-service';

interface Props {
  name: string;
  vibe: string;
  body: string;
  tags: string[];
  operator: string;
  wikipedia: string;
  photoKey: string;
  cdnUrl: string;
  displayTag?: (tag: string) => string;
}

export default function BikePathPreview({
  name, vibe, body, tags, operator, wikipedia, photoKey, cdnUrl,
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

  // Parse wikipedia field: "en:Article Title" or "fr:Titre"
  function wikipediaUrl(): string {
    if (!wikipedia) return '';
    const match = wikipedia.match(/^(\w+):(.+)$/);
    if (match) {
      const [, lang, title] = match;
      return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
    }
    return `https://en.wikipedia.org/wiki/${encodeURIComponent(wikipedia.replace(/ /g, '_'))}`;
  }

  const facts: Array<[string, string]> = [];
  if (operator) facts.push(['Operator', operator]);

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

      <h1 class="editor-preview-title">{name || 'Untitled Path'}</h1>

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

      {tags.length > 0 && (
        <div class="editor-preview-tags">
          {tags.map(tag => <span key={tag} class="tag">{displayTag(tag)}</span>)}
        </div>
      )}

      {renderedBody && (
        <div class="editor-preview-body" dangerouslySetInnerHTML={{ __html: renderedBody }} />
      )}

      {wikipedia && (
        <div class="editor-preview-links">
          <a href={wikipediaUrl()} target="_blank" rel="noopener noreferrer">Wikipedia</a>
        </div>
      )}
    </div>
  );
}
