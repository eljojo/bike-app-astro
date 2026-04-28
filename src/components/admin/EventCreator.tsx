import { useState, useRef, useCallback } from 'preact/hooks';
import EventEditor from './EventEditor';
import { useFileUpload, useHydrated } from '../../lib/hooks';
import { buildImageUrl } from '../../lib/media/image-service';
import type { EventDetail } from '../../lib/models/event-model';
import type { AdminOrganizer } from '../../types/admin';

interface Props {
  cdnUrl: string;
  organizers: AdminOrganizer[];
  copyData?: Partial<EventDetail>;
  eventOptions?: Array<{ id: string; name: string; year: string }>;
  tagTranslations?: Record<string, Record<string, string>>;
  knownTags?: string[];
  defaultLocale?: string;
  cityCenter?: [number, number];
  cityBounds?: { north: number; south: number; east: number; west: number };
  cityName?: string;
  countryCode?: string;
}

/** Draft fields returned by the server, already in EventDetail shape. */
interface EventDraftResponse {
  draft: Partial<EventDetail>;
  uncertain: string[];
  poster_key?: string;
  poster_content_type?: string;
  poster_width?: number;
  poster_height?: number;
}

const REVIEW_FIELDS = ['name', 'series', 'start_date', 'end_date', 'meet_time', 'start_time', 'end_time', 'location', 'distances', 'organizer', 'tags', 'registration_url', 'event_url', 'map_url', 'edition'] as const;

const FIELD_LABELS: Record<string, string> = {
  name: 'name',
  series: 'series',
  start_date: 'start date',
  end_date: 'end date',
  start_time: 'start time',
  meet_time: 'meet time',
  end_time: 'end time',
  location: 'location',
  distances: 'distances',
  organizer: 'organizer',
  registration_url: 'registration URL',
  event_url: 'event website',
  map_url: 'map link',
  edition: 'edition',
  tags: 'tags',
};

const DAY_NAMES_CAPITALIZED: Record<string, string> = {
  monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday',
  thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday',
};

function getSeriesDisplay(series: EventDetail['series']): string {
  if (!series) return '';
  if (series.schedule?.length) {
    const count = series.schedule.length;
    if (series.recurrence && series.recurrence_day) {
      const day = DAY_NAMES_CAPITALIZED[series.recurrence_day] || series.recurrence_day;
      const freq = series.recurrence === 'biweekly' ? 'Biweekly' : 'Weekly';
      const first = series.schedule[0].date;
      const last = series.schedule[count - 1].date;
      return `${freq} on ${day}, ${first} \u2013 ${last}`;
    }
    return `${count} dates`;
  }
  if (series.recurrence && series.recurrence_day) {
    const day = DAY_NAMES_CAPITALIZED[series.recurrence_day] || series.recurrence_day;
    const freq = series.recurrence === 'biweekly' ? 'Biweekly' : 'Weekly';
    if (series.season_start && series.season_end) {
      return `${freq} on ${day}, ${series.season_start} \u2013 ${series.season_end}`;
    }
    return `${freq} on ${day}`;
  }
  return '';
}

function getOrganizerDisplay(organizer: EventDetail['organizer']): string {
  if (!organizer) return '';
  if (typeof organizer === 'string') return organizer;
  return organizer.name || '';
}

export default function EventCreator({ cdnUrl, organizers, copyData, eventOptions, tagTranslations, knownTags, defaultLocale, cityCenter, cityBounds, cityName, countryCode }: Props) {
  const hydratedRef = useHydrated<HTMLDivElement>();
  const [phase, setPhase] = useState<'upload' | 'review' | 'edit'>(copyData ? 'edit' : 'upload');
  const [dragOver, setDragOver] = useState(false);
  const [posterKey, setPosterKey] = useState(copyData?.poster_key || '');
  const [posterContentType, setPosterContentType] = useState(copyData?.poster_content_type || '');
  const [posterWidth, setPosterWidth] = useState<number | undefined>(copyData?.poster_width);
  const [posterHeight, setPosterHeight] = useState<number | undefined>(copyData?.poster_height);
  const [extracting, setExtracting] = useState(false);
  const [eventDraft, setEventDraft] = useState<EventDraftResponse | null>(null);
  const [error, setError] = useState('');
  const [pasteUrl, setPasteUrl] = useState('');
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const upload = useFileUpload();

  /** Process an event-draft response: update poster state if present, show review or skip to edit. */
  const handleDraftResponse = useCallback((data: EventDraftResponse) => {
    // If the server staged a poster image (URL was an image), update poster state
    if (data.poster_key) {
      setPosterKey(data.poster_key);
      setPosterContentType(data.poster_content_type || 'image/jpeg');
      if (data.poster_width) setPosterWidth(data.poster_width);
      if (data.poster_height) setPosterHeight(data.poster_height);
    }

    const hasFields = Object.keys(data.draft).length > 0;
    setEventDraft(data);
    setPhase(hasFields ? 'review' : 'edit');
  }, []);

  const handlePosterUploaded = useCallback(async (key: string, contentType: string) => {
    setPosterKey(key);
    setPosterContentType(contentType);
    setExtracting(true);
    setError('');

    try {
      const res = await fetch('/api/admin/event-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ poster_key: key }),
      });

      if (!res.ok) {
        // Service unavailable (no AI binding, rate limited, etc.) — silently skip to editor
        setPhase('edit');
        return;
      }

      handleDraftResponse(await res.json() as EventDraftResponse);
    } catch {
      // Network error or unexpected failure — silently skip to editor
      setPhase('edit');
    } finally {
      setExtracting(false);
    }
  }, [handleDraftResponse]);

  async function handleFile(file: File) {
    setError('');
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file');
      return;
    }
    const results = await upload.upload(file);
    if (results && results.length > 0) {
      setPosterWidth(results[0].width);
      setPosterHeight(results[0].height);
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
      const res = await fetch('/api/admin/event-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: pasteUrl }),
      });

      if (!res.ok) {
        // Could not fetch — skip to editor with the URL pre-filled as event_url
        setEventDraft({ draft: { event_url: pasteUrl }, uncertain: [] });
        setPasteUrl('');
        setPhase('edit');
        return;
      }

      setPasteUrl('');
      handleDraftResponse(await res.json() as EventDraftResponse);
    } catch {
      // Network error — same fallback: skip to editor with URL pre-filled
      setEventDraft({ draft: { event_url: pasteUrl }, uncertain: [] });
      setPasteUrl('');
      setPhase('edit');
    } finally {
      setFetchingUrl(false);
    }
  }

  function buildInitialData(): EventDetail & { contentHash?: string; isNew?: boolean } {
    const today = new Date().toISOString().split('T')[0];
    // copyData takes priority (duplicating an event), then event draft (extraction)
    const source = copyData || eventDraft?.draft || {};
    // ICS prefill carries an ics_uid and real dates — keep them; "copy another event" blanks dates.
    const isIcsPrefill = !!(copyData && copyData.ics_uid);
    const blankDates = !!copyData && !isIcsPrefill;

    return {
      id: '',
      slug: (source.slug as string) || '',
      year: blankDates ? '' : ((source.start_date as string) || today).substring(0, 4),
      name: (source.name as string) || '',
      // When copying, leave dates empty so user must pick new ones
      start_date: blankDates ? '' : ((source.start_date as string) || today),
      start_time: source.start_time as string | undefined,
      meet_time: source.meet_time as string | undefined,
      end_date: blankDates ? undefined : (source.end_date as string | undefined),
      end_time: source.end_time as string | undefined,
      location: source.location as string | undefined,
      distances: source.distances as string | undefined,
      registration_url: source.registration_url as string | undefined,
      organizer: source.organizer as EventDetail['organizer'],
      review_url: source.review_url as string | undefined,
      edition: source.edition as string | undefined,
      event_url: source.event_url as string | undefined,
      map_url: source.map_url as string | undefined,
      poster_key: posterKey,
      poster_content_type: posterContentType,
      poster_width: posterWidth ?? (source.poster_width as number | undefined),
      poster_height: posterHeight ?? (source.poster_height as number | undefined),
      tags: (source.tags as string[]) || [],
      body: (source.body as string) || '',
      routes: (source.routes as string[]) || [],
      waypoints: (source.waypoints as EventDetail['waypoints']) || [],
      results: (source.results as EventDetail['results']) || [],
      media: (source.media as EventDetail['media']) || [],
      series: source.series as EventDetail['series'],
      ics_uid: source.ics_uid as string | undefined,
      isNew: true,
    };
  }

  // Phase: upload
  if (phase === 'upload') {
    const isLoading = upload.uploading || extracting || fetchingUrl;

    return (
      <div ref={hydratedRef} class="event-creator">
        {isLoading ? (
          <div class="event-creator-loading">
            <div class="event-creator-spinner" />
            <span>{upload.uploading ? 'Uploading poster...' : fetchingUrl ? 'Reading link...' : 'Reading poster...'}</span>
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
                placeholder="Paste a link to a poster or event page"
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
  if (phase === 'review' && eventDraft) {
    const { draft, uncertain } = eventDraft;
    const hasUncertainFields = uncertain.length > 0;

    return (
      <div ref={hydratedRef} class="event-creator">
        <div class={`event-creator-review ${posterKey ? '' : 'event-creator-review--no-poster'}`}>
          {posterKey && (
            <div class="event-creator-review-poster">
              <img src={buildImageUrl(cdnUrl, posterKey, { width: 300, format: 'auto' })} alt="Event poster" />
            </div>
          )}
          <div class="event-creator-review-data">
            <h3>Here's what we found</h3>
            <table class="extraction-table">
              <tbody>
                {REVIEW_FIELDS.map(field => {
                  const value = field === 'organizer'
                    ? getOrganizerDisplay(draft.organizer as EventDetail['organizer'])
                    : field === 'tags'
                      ? (Array.isArray(draft.tags) && draft.tags.length > 0 ? (draft.tags as string[]).join(', ') : '')
                      : field === 'series'
                        ? getSeriesDisplay(draft.series)
                        : draft[field] as string | undefined;
                  if (!value) return null;
                  const isUncertain = uncertain.includes(field);
                  const label = field === 'start_time' && draft.meet_time
                    ? 'ride time'
                    : (FIELD_LABELS[field] || field);
                  return (
                    <tr key={field}>
                      <td class="field-name">{label}</td>
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
      eventOptions={eventOptions}
      tagTranslations={tagTranslations}
      knownTags={knownTags}
      defaultLocale={defaultLocale}
      cityCenter={cityCenter}
      cityBounds={cityBounds}
      cityName={cityName}
      countryCode={countryCode}
    />
  );
}
