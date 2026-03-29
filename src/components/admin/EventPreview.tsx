import { useMemo } from 'preact/hooks';
import { marked } from 'marked';
import { buildMediaThumbnailUrl } from '../../lib/media/image-service';
import type { MediaThumbnailConfig } from '../../lib/media/image-service';

interface Props {
  name: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  meetTime: string;
  location: string;
  organizer: string;
  distances: string;
  registrationUrl: string;
  eventUrl: string;
  posterKey: string;
  tags: string[];
  body: string;
  cdnUrl: string;
}

export default function EventPreview({
  name, startDate, startTime, endDate, endTime, meetTime,
  location, organizer, distances, registrationUrl, eventUrl,
  posterKey, tags, body, cdnUrl,
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

  function posterUrl(width: number) {
    if (!posterKey) return '';
    return buildMediaThumbnailUrl({ key: posterKey }, thumbConfig, { width, format: 'auto' });
  }

  const facts: Array<[string, string]> = [];
  if (startDate) {
    const dateStr = endDate && endDate !== startDate
      ? `${startDate} — ${endDate}`
      : startDate;
    facts.push(['Date', dateStr]);
  }
  if (startTime) {
    const timeStr = endTime ? `${startTime} — ${endTime}` : startTime;
    facts.push(['Time', timeStr]);
  }
  if (meetTime) facts.push(['Meet time', meetTime]);
  if (location) facts.push(['Location', location]);
  if (organizer) facts.push(['Organizer', organizer]);
  if (distances) facts.push(['Distances', distances]);

  return (
    <div class="editor-preview-pane">
      {posterKey && (
        <img
          class="editor-preview-photo"
          src={posterUrl(830)}
          srcset={`${posterUrl(1660)} 2x`}
          alt={name}
        />
      )}

      <h1 class="editor-preview-title">{name || 'Untitled Event'}</h1>

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
          {tags.map(tag => <span key={tag} class="tag">{tag}</span>)}
        </div>
      )}

      {renderedBody && (
        <div class="editor-preview-body" dangerouslySetInnerHTML={{ __html: renderedBody }} />
      )}

      {(registrationUrl || eventUrl) && (
        <div class="editor-preview-links">
          {registrationUrl && <a href={registrationUrl} target="_blank" rel="noopener noreferrer">Registration</a>}
          {eventUrl && <a href={eventUrl} target="_blank" rel="noopener noreferrer">Event website</a>}
        </div>
      )}
    </div>
  );
}
