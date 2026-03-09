import { useState, useRef, useCallback } from 'preact/hooks';
import EventEditor from './EventEditor';
import { useFileUpload } from '../../lib/hooks';
import { fuzzyMatchOrganizer } from '../../lib/fuzzy-match';
import { slugify } from '../../lib/slug';
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

interface FieldValue {
  value: string;
  confidence: number;
}

type ExtractedFields = Partial<Record<string, FieldValue>>;

const HIGH_CONFIDENCE = 0.7;
const MEDIUM_CONFIDENCE = 0.4;

export default function EventCreator({ cdnUrl, organizers }: Props) {
  const [phase, setPhase] = useState<'upload' | 'review' | 'edit'>('upload');
  const [dragOver, setDragOver] = useState(false);
  const [posterKey, setPosterKey] = useState('');
  const [posterContentType, setPosterContentType] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedFields>({});
  const [error, setError] = useState('');
  const [pasteUrl, setPasteUrl] = useState('');
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const upload = useFileUpload();

  const organizerNames = organizers.map(o => o.name);

  const handlePosterUploaded = useCallback(async (key: string, contentType: string) => {
    setPosterKey(key);
    setPosterContentType(contentType);
    setExtracting(true);
    setError('');

    try {
      const res = await fetch('/api/admin/ai-extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poster_key: key,
          organizers: organizerNames,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'AI extraction failed');
      }

      const data = await res.json();
      setExtracted(data.extracted || {});
      setPhase('review');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Extraction failed');
      // Still allow proceeding even if extraction fails
      setPhase('review');
    } finally {
      setExtracting(false);
    }
  }, [organizerNames]);

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

  function getFieldValue(field: string): string {
    const f = extracted[field];
    if (!f) return '';
    if (typeof f === 'object' && 'value' in f) return f.value || '';
    // Model returned flat values (no confidence wrapper)
    return String(f);
  }

  function getConfidence(field: string): number {
    const f = extracted[field];
    if (!f) return 0;
    if (typeof f === 'object' && 'confidence' in f) return f.confidence;
    // Flat value — assume medium confidence
    return 0.6;
  }

  function buildInitialData(): EventDetail & { contentHash?: string; isNew?: boolean } {
    const today = new Date().toISOString().split('T')[0];
    const name = getFieldValue('name');

    // Resolve organizer via fuzzy match
    const aiOrganizer = getFieldValue('organizer');
    const orgMatch = aiOrganizer ? fuzzyMatchOrganizer(aiOrganizer, organizers) : null;
    const orgConfidence = getConfidence('organizer');
    const useOrgMatch = orgMatch && orgConfidence >= HIGH_CONFIDENCE;

    return {
      id: '',
      slug: name ? slugify(name) : '',
      year: (getFieldValue('start_date') || today).substring(0, 4),
      name,
      start_date: getFieldValue('start_date') || today,
      start_time: getFieldValue('start_time') || undefined,
      end_date: getFieldValue('end_date') || undefined,
      end_time: getFieldValue('end_time') || undefined,
      location: getFieldValue('location') || undefined,
      distances: getFieldValue('distances') || undefined,
      registration_url: getFieldValue('registration_url') || undefined,
      organizer: useOrgMatch
        ? orgMatch.slug
        : aiOrganizer
          ? { name: aiOrganizer }
          : undefined,
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
            <span>{upload.uploading ? 'Uploading poster...' : fetchingUrl ? 'Fetching image...' : 'Analyzing poster with AI...'}</span>
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
            <div class="route-creator-divider"><span>or</span></div>
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

  // Phase: review — show what AI found, let user proceed
  if (phase === 'review') {
    const fields = ['name', 'start_date', 'end_date', 'start_time', 'end_time', 'location', 'distances', 'organizer', 'registration_url'] as const;
    const hasExtracted = fields.some(f => getFieldValue(f));
    const aiOrganizer = getFieldValue('organizer');
    const orgMatch = aiOrganizer ? fuzzyMatchOrganizer(aiOrganizer, organizers) : null;

    return (
      <div class="event-creator">
        <div class="event-creator-review">
          <div class="event-creator-review-poster">
            <img src={`${cdnUrl}/cdn-cgi/image/width=300,format=auto/${posterKey}`} alt="Event poster" />
          </div>
          <div class="event-creator-review-data">
            <h3>{hasExtracted ? 'AI extracted the following' : 'Could not extract event details'}</h3>
            {hasExtracted && (
              <table class="extraction-table">
                <tbody>
                  {fields.map(field => {
                    const value = getFieldValue(field);
                    if (!value) return null;
                    const conf = getConfidence(field);
                    const level = conf >= HIGH_CONFIDENCE ? 'high' : conf >= MEDIUM_CONFIDENCE ? 'medium' : 'low';
                    return (
                      <tr key={field}>
                        <td class="field-name">{field.replace(/_/g, ' ')}</td>
                        <td>
                          {field === 'organizer' && orgMatch
                            ? <><span>{value}</span>{' \u2192 '}<strong>{orgMatch.name}</strong></>
                            : value
                          }
                        </td>
                        <td class={`confidence-${level}`}>
                          {level === 'high' ? '\u2713' : level === 'medium' ? '?' : '!'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <p class="event-creator-review-hint">You can edit all fields after continuing.</p>
            <button type="button" class="btn-primary" onClick={() => setPhase('edit')}>
              {hasExtracted ? 'Continue with these details' : 'Continue to editor'}
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
