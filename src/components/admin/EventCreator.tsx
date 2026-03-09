import { useState, useRef, useCallback } from 'preact/hooks';
import EventEditor from './EventEditor';
import { useFileUpload } from '../../lib/hooks';
import type { EventDetail } from '../../lib/models/event-model';

interface OrganizerData {
  slug: string;
  name: string;
  website?: string;
  instagram?: string;
}

interface Props {
  cdnUrl: string;
  organizers: OrganizerData[];
}

/** Draft fields returned by the server, already in EventDetail shape. */
interface PosterDraft {
  draft: Partial<EventDetail>;
  uncertain: string[];
}

const REVIEW_FIELDS = ['name', 'start_date', 'end_date', 'start_time', 'end_time', 'location', 'distances', 'organizer', 'registration_url'] as const;

const FIELD_LABELS: Record<string, string> = {
  name: 'name',
  start_date: 'start date',
  end_date: 'end date',
  start_time: 'start time',
  end_time: 'end time',
  location: 'location',
  distances: 'distances',
  organizer: 'organizer',
  registration_url: 'registration URL',
};

function getOrganizerDisplay(organizer: EventDetail['organizer']): string {
  if (!organizer) return '';
  if (typeof organizer === 'string') return organizer;
  return organizer.name || '';
}

export default function EventCreator({ cdnUrl, organizers }: Props) {
  const [phase, setPhase] = useState<'upload' | 'review' | 'edit'>('upload');
  const [dragOver, setDragOver] = useState(false);
  const [posterKey, setPosterKey] = useState('');
  const [posterContentType, setPosterContentType] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [posterDraft, setPosterDraft] = useState<PosterDraft | null>(null);
  const [error, setError] = useState('');
  const [pasteUrl, setPasteUrl] = useState('');
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const upload = useFileUpload();

  const handlePosterUploaded = useCallback(async (key: string, contentType: string) => {
    setPosterKey(key);
    setPosterContentType(contentType);
    setExtracting(true);
    setError('');

    try {
      const res = await fetch('/api/admin/poster-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ poster_key: key }),
      });

      if (!res.ok) {
        // Service unavailable (no AI binding, rate limited, etc.) — silently skip to editor
        setPhase('edit');
        return;
      }

      const data = await res.json();
      const { draft, uncertain } = data as PosterDraft;
      const hasFields = Object.keys(draft).length > 0;

      setPosterDraft({ draft, uncertain });
      setPhase(hasFields ? 'review' : 'edit');
    } catch {
      // Network error or unexpected failure — silently skip to editor
      setPhase('edit');
    } finally {
      setExtracting(false);
    }
  }, []);

  async function handleFile(file: File) {
    setError('');
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file');
      return;
    }
    const results = await upload.upload(file);
    if (results && results.length > 0) {
      await handlePosterUploaded(results[0].key, results[0].contentType || file.type);
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files[0];
    if (file) handleFile(file);
  }

  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files?.[0]) {
      handleFile(input.files[0]);
      input.value = '';
    }
  }

  async function handleUrlFetch() {
    if (!pasteUrl.trim()) return;
    setError('');
    setFetchingUrl(true);

    try {
      const res = await fetch('/api/admin/fetch-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: pasteUrl }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to fetch image');
      }

      const { key, contentType } = await res.json();
      setPasteUrl('');
      await handlePosterUploaded(key, contentType);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch image');
    } finally {
      setFetchingUrl(false);
    }
  }

  function buildInitialData(): EventDetail & { contentHash?: string; isNew?: boolean } {
    const today = new Date().toISOString().split('T')[0];
    const draft = posterDraft?.draft || {};

    return {
      id: '',
      slug: (draft.slug as string) || '',
      year: ((draft.start_date as string) || today).substring(0, 4),
      name: (draft.name as string) || '',
      start_date: (draft.start_date as string) || today,
      start_time: draft.start_time as string | undefined,
      end_date: draft.end_date as string | undefined,
      end_time: draft.end_time as string | undefined,
      location: draft.location as string | undefined,
      distances: draft.distances as string | undefined,
      registration_url: draft.registration_url as string | undefined,
      organizer: draft.organizer as EventDetail['organizer'],
      poster_key: posterKey,
      poster_content_type: posterContentType,
      body: '',
      isNew: true,
    };
  }

  // Phase: upload
  if (phase === 'upload') {
    const isLoading = upload.uploading || extracting || fetchingUrl;

    return (
      <div class="event-creator">
        {isLoading ? (
          <div class="event-creator-loading">
            <div class="event-creator-spinner" />
            <span>{upload.uploading ? 'Uploading poster...' : fetchingUrl ? 'Fetching image...' : 'Reading poster...'}</span>
          </div>
        ) : (
          <div class="event-creator-prompt">
            <div
              class={`drop-zone drop-zone--hero ${dragOver ? 'drop-zone--active' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <svg class="drop-zone-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <span class="drop-zone-label">Drop an event poster here</span>
              <span class="drop-zone-hint">or click to choose an image</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style="display:none"
                onChange={handleFileSelect}
              />
            </div>
            <div class="creator-divider"><span>or</span></div>
            <div class="url-import">
              <input
                type="url"
                class="url-import-input"
                placeholder="Paste a link to a poster image"
                value={pasteUrl}
                onInput={(e) => setPasteUrl((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleUrlFetch(); } }}
              />
              {pasteUrl.trim() && (
                <button type="button" class="btn-secondary" onClick={handleUrlFetch} disabled={fetchingUrl}>
                  {fetchingUrl ? 'Fetching...' : 'Fetch'}
                </button>
              )}
            </div>
            <p class="event-creator-skip">
              <button type="button" class="btn-link" onClick={() => setPhase('edit')}>
                Skip — create without a poster
              </button>
            </p>
          </div>
        )}
        {(error || upload.error) && <div class="auth-error">{error || upload.error}</div>}
      </div>
    );
  }

  // Phase: review — show what was found, let user proceed
  if (phase === 'review' && posterDraft) {
    const { draft, uncertain } = posterDraft;
    const hasUncertainFields = uncertain.length > 0;

    return (
      <div class="event-creator">
        <div class="event-creator-review">
          <div class="event-creator-review-poster">
            <img src={`${cdnUrl}/cdn-cgi/image/width=300,format=auto/${posterKey}`} alt="Event poster" />
          </div>
          <div class="event-creator-review-data">
            <h3>Here's what we found</h3>
            <table class="extraction-table">
              <tbody>
                {REVIEW_FIELDS.map(field => {
                  const value = field === 'organizer'
                    ? getOrganizerDisplay(draft.organizer as EventDetail['organizer'])
                    : draft[field] as string | undefined;
                  if (!value) return null;
                  const isUncertain = uncertain.includes(field);
                  return (
                    <tr key={field}>
                      <td class="field-name">{FIELD_LABELS[field] || field}</td>
                      <td>{value}</td>
                      {hasUncertainFields && (
                        <td class={isUncertain ? 'confidence-medium' : ''}>
                          {isUncertain ? '?' : ''}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p class="event-creator-review-hint">You can edit all fields after continuing.</p>
            <button type="button" class="btn-primary" onClick={() => setPhase('edit')}>
              Continue with these details
            </button>
          </div>
        </div>
        {error && <div class="auth-error">{error}</div>}
      </div>
    );
  }

  // Phase: edit — render EventEditor with pre-filled data
  const initialData = buildInitialData();

  return (
    <EventEditor
      initialData={initialData}
      organizers={organizers}
      cdnUrl={cdnUrl}
    />
  );
}
