import { useState, useRef, useCallback } from 'preact/hooks';
import { useHydrated, useFileUpload } from '../../lib/hooks';
import WizardLayout, { WizardNav } from './WizardLayout';
import { useWizardSkips, buildCelebrateUrl } from './wizard-helpers';
import { useProgressiveDisclosure } from './useProgressiveDisclosure';
import { useFormValidation } from './useFormValidation';
import { useEditorForm } from './useEditorForm';
import { bindText } from './field-helpers';
import MarkdownEditor from './MarkdownEditor';
import PhotoField from './PhotoField';
import TagEditor from './TagEditor';
import EventPreview from './EventPreview';
import SeriesEditor from './SeriesEditor';
import LocationField from './LocationField';
import { buildImageUrl } from '../../lib/media/image-service';
import { slugify } from '../../lib/slug';
import type { EventDetail, EventSeries } from '../../lib/models/event-model';
import type { EventUpdate } from '../../views/api/event-save';
import type { AdminOrganizer } from '../../types/admin';

const STOPS = ['Poster', 'When & Where', 'Story', 'Details', 'Organizer', 'Go Live'];

interface Props {
  cdnUrl: string;
  organizers: AdminOrganizer[];
  eventOptions?: Array<{ id: string; name: string; year: string }>;
  tagTranslations?: Record<string, Record<string, string>>;
  knownTags?: string[];
  defaultLocale?: string;
  userRole?: string;
  showLicenseNotice?: boolean;
  guestLabel?: string;
  siteName?: string;
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

const REVIEW_FIELDS = ['name', 'series', 'start_date', 'end_date', 'start_time', 'meet_time', 'end_time', 'location', 'distances', 'organizer', 'tags', 'registration_url', 'event_url', 'map_url', 'edition'] as const;

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

export default function EventWizard({
  cdnUrl,
  organizers,
  eventOptions = [],
  tagTranslations = {},
  knownTags = [],
  // eslint-disable-next-line bike-app/no-hardcoded-city-locale -- fallback default for prop
  defaultLocale = 'en',
  userRole,
  showLicenseNotice,
  guestLabel,
  siteName,
  cityCenter,
  cityBounds,
  cityName,
  countryCode,
}: Props) {
  const hydratedRef = useHydrated<HTMLDivElement>();
  const { step, setStep, skippedSteps, skipStep } = useWizardSkips();

  // Poster step state
  const upload = useFileUpload();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [posterKey, setPosterKey] = useState('');
  const [posterContentType, setPosterContentType] = useState('');
  const [posterWidth, setPosterWidth] = useState<number | undefined>(undefined);
  const [posterHeight, setPosterHeight] = useState<number | undefined>(undefined);
  const [extracting, setExtracting] = useState(false);
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const [pasteUrl, setPasteUrl] = useState('');
  const [posterError, setPosterError] = useState('');
  const [eventDraft, setEventDraft] = useState<EventDraftResponse | null>(null);
  const [draftReviewed, setDraftReviewed] = useState(false);

  // When & Where step state
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [meetTime, setMeetTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [location, setLocation] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [orgName, setOrgName] = useState('');
  const [orgWebsite, setOrgWebsite] = useState('');
  const [orgInstagram, setOrgInstagram] = useState('');
  const [orgPhotoKey, setOrgPhotoKey] = useState('');
  const [orgPhotoContentType, setOrgPhotoContentType] = useState('');
  const [orgPhotoWidth, setOrgPhotoWidth] = useState<number | undefined>(undefined);
  const [orgPhotoHeight, setOrgPhotoHeight] = useState<number | undefined>(undefined);
  const [isExistingRef, setIsExistingRef] = useState(false);
  const [seriesMode, setSeriesMode] = useState(false);
  const [seriesData, setSeriesData] = useState<EventSeries | undefined>(undefined);
  const [seriesValid, setSeriesValid] = useState(false);

  // Story step state
  const [body, setBody] = useState('');
  const [distances, setDistances] = useState('');
  const [registrationUrl, setRegistrationUrl] = useState('');

  // Details step state
  const [tags, setTags] = useState<string[]>([]);
  const [eventUrl, setEventUrl] = useState('');
  const [mapUrl, setMapUrl] = useState('');
  const [edition, setEdition] = useState('');
  const [previousEvent, setPreviousEvent] = useState('');

  // Progressive disclosure for When & Where
  const disclosure = useProgressiveDisclosure({
    time: false,
    meetTime: false,
    endDate: false,
    endTime: false,
    orgForm: false,
  });

  // Apply extracted draft to form fields
  const applyDraft = useCallback((draft: Partial<EventDetail>) => {
    if (draft.name) setName(draft.name as string);
    if (draft.start_date) setStartDate(draft.start_date as string);
    if (draft.start_time) { setStartTime(draft.start_time as string); disclosure.open('time'); }
    if (draft.meet_time) { setMeetTime(draft.meet_time as string); disclosure.open('meetTime'); }
    if (draft.end_date) { setEndDate(draft.end_date as string); disclosure.open('endDate'); }
    if (draft.end_time) { setEndTime(draft.end_time as string); disclosure.open('endTime'); }
    if (draft.location) setLocation(draft.location as string);
    if (draft.distances) setDistances(draft.distances as string);
    if (draft.registration_url) setRegistrationUrl(draft.registration_url as string);
    if (draft.event_url) setEventUrl(draft.event_url as string);
    if (draft.map_url) setMapUrl(draft.map_url as string);
    if (draft.edition) setEdition(draft.edition as string);
    if (draft.tags && Array.isArray(draft.tags)) setTags(draft.tags as string[]);
    if (draft.body) setBody(draft.body as string);
    if (draft.series) {
      setSeriesMode(true);
      setSeriesData(draft.series as EventSeries);
      setSeriesValid(true);
    }
    if (draft.organizer) {
      const org = draft.organizer;
      if (typeof org === 'string') {
        const found = organizers.find(o => o.slug === org);
        if (found) {
          setOrgSlug(found.slug);
          setOrgName(found.name);
          setOrgWebsite(found.website || '');
          setOrgInstagram(found.instagram || '');
          setOrgPhotoKey(found.photo_key || '');
          setOrgPhotoContentType(found.photo_content_type || '');
          setOrgPhotoWidth(found.photo_width);
          setOrgPhotoHeight(found.photo_height);
          setIsExistingRef(true);
          disclosure.open('orgForm');
        }
      } else {
        setOrgName(org.name || '');
        setOrgWebsite(org.website || '');
        setOrgInstagram(org.instagram || '');
        setOrgPhotoKey(org.photo_key || '');
        setOrgPhotoContentType(org.photo_content_type || '');
        disclosure.open('orgForm');
      }
    }
  }, [organizers, disclosure]);

  // Poster upload + AI extraction
  const handleDraftResponse = useCallback((data: EventDraftResponse) => {
    if (data.poster_key) {
      setPosterKey(data.poster_key);
      setPosterContentType(data.poster_content_type || 'image/jpeg');
      if (data.poster_width) setPosterWidth(data.poster_width);
      if (data.poster_height) setPosterHeight(data.poster_height);
    }
    setEventDraft(data);
    const hasFields = Object.keys(data.draft).length > 0;
    if (hasFields) {
      // Stay on poster step in review mode
    } else {
      // No fields extracted — go straight to When & Where
      setDraftReviewed(true);
      setStep(2);
    }
  }, []);

  const handlePosterUploaded = useCallback(async (key: string, contentType: string) => {
    setPosterKey(key);
    setPosterContentType(contentType);
    setExtracting(true);
    setPosterError('');

    try {
      const res = await fetch('/api/admin/event-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ poster_key: key }),
      });

      if (!res.ok) {
        setDraftReviewed(true);
        setStep(2);
        return;
      }

      handleDraftResponse(await res.json() as EventDraftResponse);
    } catch {
      setDraftReviewed(true);
      setStep(2);
    } finally {
      setExtracting(false);
    }
  }, [handleDraftResponse]);

  async function handleFile(file: File) {
    setPosterError('');
    if (!file.type.startsWith('image/')) {
      setPosterError('Please upload an image file');
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
    setPosterError('');
    setFetchingUrl(true);
    try {
      const res = await fetch('/api/admin/event-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: pasteUrl }),
      });
      if (!res.ok) {
        setEventDraft({ draft: { event_url: pasteUrl }, uncertain: [] });
        setEventUrl(pasteUrl);
        setPasteUrl('');
        setDraftReviewed(true);
        setStep(2);
        return;
      }
      setPasteUrl('');
      handleDraftResponse(await res.json() as EventDraftResponse);
    } catch {
      setEventDraft({ draft: { event_url: pasteUrl }, uncertain: [] });
      setEventUrl(pasteUrl);
      setPasteUrl('');
      setDraftReviewed(true);
      setStep(2);
    } finally {
      setFetchingUrl(false);
    }
  }

  // Series change handler
  const handleSeriesChange = useCallback((series: EventSeries | undefined, firstDate: string, lastDate: string, isValid: boolean) => {
    setSeriesData(series);
    setSeriesValid(isValid);
    if (isValid) {
      setStartDate(firstDate);
      setEndDate(lastDate);
    }
  }, []);

  // Organizer helpers
  function selectOrganizer(slug: string) {
    setOrgSlug(slug);
    const org = organizers.find(o => o.slug === slug);
    if (org) {
      setOrgName(org.name);
      setOrgWebsite(org.website || '');
      setOrgInstagram(org.instagram || '');
      setOrgPhotoKey(org.photo_key || '');
      setOrgPhotoContentType(org.photo_content_type || '');
      setOrgPhotoWidth(org.photo_width);
      setOrgPhotoHeight(org.photo_height);
      setIsExistingRef(true);
      disclosure.open('orgForm');
    } else {
      setOrgName('');
      setOrgWebsite('');
      setOrgInstagram('');
      setOrgPhotoKey('');
      setOrgPhotoContentType('');
      setOrgPhotoWidth(undefined);
      setOrgPhotoHeight(undefined);
      setIsExistingRef(false);
      disclosure.close('orgForm');
    }
  }

  function createNewOrganizer() {
    setOrgSlug('');
    setOrgName('');
    setOrgWebsite('');
    setOrgInstagram('');
    setOrgPhotoKey('');
    setOrgPhotoContentType('');
    setOrgPhotoWidth(undefined);
    setOrgPhotoHeight(undefined);
    setIsExistingRef(false);
    disclosure.open('orgForm');
  }

  // Form validation for When & Where step
  const { validate } = useFormValidation([
    { field: 'wizard-event-name', check: () => !name.trim(), message: 'Event name is required' },
    { field: 'wizard-start-date', check: () => !seriesMode && !startDate, message: 'Date is required' },
    { field: 'wizard-start-date', check: () => !seriesMode && !!startDate && startDate < new Date().toISOString().split('T')[0], message: 'Date cannot be in the past' },
    { field: 'series-season-start', check: () => seriesMode && !seriesValid, message: 'Series needs at least one active occurrence' },
  ]);

  // Save form
  const editor = useEditorForm({
    apiBase: '/api/events',
    contentId: null,
    userRole,
    deps: [name, startDate, startTime, meetTime, endDate, endTime, location, distances, registrationUrl, eventUrl, mapUrl, edition, previousEvent, posterKey, posterContentType, tags, body, orgSlug, orgName, seriesMode, seriesData],
    validate,
    buildPayload: () => {
      const payload: EventUpdate = {
        frontmatter: {
          name,
          start_date: startDate,
          ...(startTime && { start_time: startTime }),
          ...(meetTime && { meet_time: meetTime }),
          ...(endDate && { end_date: endDate }),
          ...(endTime && { end_time: endTime }),
          ...(seriesMode && seriesData && { series: seriesData }),
          ...(location && { location }),
          ...(distances && { distances }),
          ...(registrationUrl && { registration_url: registrationUrl }),
          ...(eventUrl && { event_url: eventUrl }),
          ...(mapUrl && { map_url: mapUrl }),
          ...(edition && { edition }),
          ...(previousEvent && { previous_event: previousEvent }),
          ...(posterKey && {
            poster_key: posterKey,
            poster_content_type: posterContentType || 'image/jpeg',
            ...(posterWidth && { poster_width: posterWidth }),
            ...(posterHeight && { poster_height: posterHeight }),
          }),
          ...(tags.length > 0 && { tags }),
        },
        body,
      };
      if (disclosure.isOpen('orgForm') && orgName) {
        payload.organizer = {
          slug: orgSlug || slugify(orgName),
          name: orgName,
          ...(orgWebsite && { website: orgWebsite }),
          ...(orgInstagram && { instagram: orgInstagram }),
          ...(orgPhotoKey && {
            photo_key: orgPhotoKey,
            photo_content_type: orgPhotoContentType || 'image/jpeg',
            ...(orgPhotoWidth && { photo_width: orgPhotoWidth }),
            ...(orgPhotoHeight && { photo_height: orgPhotoHeight }),
          }),
          isExistingRef,
        };
      }
      return payload as unknown as Record<string, unknown>;
    },
    onSuccess: (result) => {
      const id = result?.id || '';
      window.location.href = buildCelebrateUrl('event', id, skippedSteps);
    },
  });

  // --- Step renderers ---

  function renderWelcome() {
    return (
      <div class="wizard-welcome">
        <h1 class="wizard-welcome-heading">
          Add an event{siteName ? ` to ${siteName}` : ''}
        </h1>
        <p class="wizard-welcome-body">
          If you have an event poster, drop it in — we'll read the details from it automatically.
          Or paste a link to the event page. You can also fill everything in by hand.
        </p>
        <div class="wizard-welcome-begin">
          <button type="button" class="btn-primary" onClick={() => setStep(1)}>
            Let's go
          </button>
        </div>
        <p class="wizard-welcome-skip">
          <button type="button" class="btn-link" onClick={() => { window.location.href = '/admin/events/new?full=1'; }}>
            Skip to full editor
          </button>
        </p>
      </div>
    );
  }

  function renderPoster() {
    const isLoading = upload.uploading || extracting || fetchingUrl;

    // Review phase: show extracted fields
    if (eventDraft && !draftReviewed) {
      const { draft, uncertain } = eventDraft;
      const hasUncertainFields = uncertain.length > 0;

      return (
        <>
          <h2 class="wizard-step-heading">Here's what we found</h2>
          <div class={`event-creator-review ${posterKey ? '' : 'event-creator-review--no-poster'}`}>
            {posterKey && (
              <div class="event-creator-review-poster">
                <img src={buildImageUrl(cdnUrl, posterKey, { width: 300, format: 'auto' })} alt="Event poster" />
              </div>
            )}
            <div class="event-creator-review-data">
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
            </div>
          </div>
          <WizardNav
            onBack={() => setEventDraft(null)}
            onNext={() => {
              applyDraft(eventDraft.draft);
              setDraftReviewed(true);
              setStep(2);
            }}
            nextLabel="Continue with these details"
          />
        </>
      );
    }

    return (
      <>
        <h2 class="wizard-step-heading">Do you have a poster?</h2>
        <p class="wizard-step-subheading">
          We'll read the event details from a poster image or event page link automatically.
        </p>
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
          </div>
        )}
        {(posterError || upload.error) && <div class="auth-error">{posterError || upload.error}</div>}
        <WizardNav
          onBack={() => setStep(0)}
          onNext={() => setStep(2)}
          skipLabel="Skip — fill in manually"
          onSkip={() => skipStep('poster', 2)}
        />
      </>
    );
  }

  function renderWhenWhere() {
    return (
      <>
        <h2 class="wizard-step-heading">When and where?</h2>
        <div class="auth-form">
          <div class="form-field">
            <label for="wizard-event-name">Event name</label>
            <input id="wizard-event-name" type="text" {...bindText(name, setName)} />
          </div>

          {/* Normal / Series toggle */}
          <div class="form-field">
            <label>Event type</label>
            <div class="series-toggle">
              <button
                type="button"
                class={`series-toggle-btn${!seriesMode ? ' series-toggle-btn--active' : ''}`}
                onClick={() => setSeriesMode(false)}
              >
                Normal event
              </button>
              <button
                type="button"
                class={`series-toggle-btn${seriesMode ? ' series-toggle-btn--active' : ''}`}
                onClick={() => setSeriesMode(true)}
              >
                Series
              </button>
            </div>
          </div>

          {!seriesMode && (
            <>
              <div class="form-field">
                <label for="wizard-start-date">{disclosure.isOpen('endDate') ? 'Start date' : 'Date'}</label>
                <input id="wizard-start-date" type="date" min={new Date().toISOString().split('T')[0]} {...bindText(startDate, setStartDate)} />
              </div>

              {disclosure.isOpen('time') && (
                <div class="form-field">
                  <label for="wizard-start-time">{disclosure.isOpen('endDate') ? 'Start time' : 'Time'}</label>
                  <input id="wizard-start-time" type="time" {...bindText(startTime, setStartTime)} />
                </div>
              )}

              {disclosure.isOpen('time') && disclosure.isOpen('meetTime') && (
                <div class="form-field">
                  <label for="wizard-meet-time">Meet time</label>
                  <input id="wizard-meet-time" type="time" {...bindText(meetTime, setMeetTime)} />
                </div>
              )}

              {disclosure.isOpen('endTime') && !disclosure.isOpen('endDate') && (
                <div class="form-field">
                  <label for="wizard-end-time">End time</label>
                  <input id="wizard-end-time" type="time" {...bindText(endTime, setEndTime)} />
                </div>
              )}

              {disclosure.isOpen('endDate') && (
                <>
                  <div class="form-field">
                    <label for="wizard-end-date">End date</label>
                    <input id="wizard-end-date" type="date" {...bindText(endDate, setEndDate)} />
                  </div>
                  {disclosure.isOpen('endTime') && (
                    <div class="form-field">
                      <label for="wizard-end-time">End time</label>
                      <input id="wizard-end-time" type="time" {...bindText(endTime, setEndTime)} />
                    </div>
                  )}
                </>
              )}

              <div class="disclosure-links">
                {!disclosure.isOpen('time') && (
                  <button type="button" class="btn-link" onClick={() => disclosure.open('time')}>Set time</button>
                )}
                {disclosure.isOpen('time') && !disclosure.isOpen('meetTime') && (
                  <button type="button" class="btn-link" onClick={() => disclosure.open('meetTime')}>Set meet time</button>
                )}
                {disclosure.isOpen('time') && !disclosure.isOpen('endTime') && (
                  <button type="button" class="btn-link" onClick={() => disclosure.open('endTime')}>Set end time</button>
                )}
                {!disclosure.isOpen('endDate') && (
                  <button type="button" class="btn-link" onClick={() => {
                    disclosure.open('endDate');
                    if (!endDate && startDate) {
                      const next = new Date(startDate);
                      next.setDate(next.getDate() + 1);
                      setEndDate(next.toISOString().split('T')[0]);
                    }
                  }}>Ends on a different day</button>
                )}
              </div>
            </>
          )}

          {seriesMode && (
            <>
              <div class="disclosure-links">
                {!disclosure.isOpen('time') && (
                  <button type="button" class="btn-link" onClick={() => disclosure.open('time')}>Set time</button>
                )}
              </div>
              {disclosure.isOpen('time') && (
                <div class="form-field">
                  <label for="wizard-start-time">Time</label>
                  <input id="wizard-start-time" type="time" {...bindText(startTime, setStartTime)} />
                </div>
              )}
              {disclosure.isOpen('time') && (
                <div class="disclosure-links">
                  {!disclosure.isOpen('meetTime') && (
                    <button type="button" class="btn-link" onClick={() => disclosure.open('meetTime')}>Set meet time</button>
                  )}
                </div>
              )}
              {disclosure.isOpen('time') && disclosure.isOpen('meetTime') && (
                <div class="form-field">
                  <label for="wizard-meet-time">Meet time</label>
                  <input id="wizard-meet-time" type="time" {...bindText(meetTime, setMeetTime)} />
                </div>
              )}
              <SeriesEditor
                initialSeries={undefined}
                eventLocation={location}
                eventStartTime={startTime}
                eventMeetTime={meetTime}
                locale={defaultLocale}
                onSeriesChange={handleSeriesChange}
              />
            </>
          )}

          <div class="form-field">
            <label for="wizard-location">Location</label>
            <span class="form-field-hint">Address or landmark</span>
            {cityCenter ? (
              <LocationField
                id="wizard-location"
                value={location}
                onChange={setLocation}
                cityCenter={cityCenter}
                cityBounds={cityBounds}
                cityName={cityName}
                countryCode={countryCode}
                placeholder="111 Wellington St, K1A 0A6"
              />
            ) : (
              <input id="wizard-location" type="text" {...bindText(location, setLocation)}
                placeholder="111 Wellington St, K1A 0A6" />
            )}
          </div>

        </div>
        <WizardNav
          onBack={() => setStep(1)}
          onNext={() => {
            const err = validate();
            if (err) { editor.setError(err); return; }
            editor.setError('');
            setStep(3);
          }}
          nextDisabled={!name.trim()}
        />
        {editor.error && <div class="auth-error">{editor.error}</div>}
      </>
    );
  }

  function renderStory() {
    return (
      <>
        <h2 class="wizard-step-heading">Tell the story</h2>
        <p class="wizard-step-subheading">
          A description helps people decide if this event is for them.
        </p>
        <div class="auth-form">
          <div class="form-field">
            <label for="wizard-body">Description</label>
            <span class="form-field-hint">Formatting supported</span>
            <MarkdownEditor id="wizard-body" value={body} onChange={setBody} rows={8} />
          </div>
          <div class="form-field">
            <label for="wizard-distances">Distances</label>
            <input id="wizard-distances" type="text" {...bindText(distances, setDistances)}
              placeholder="e.g. 10km loop, 25km and 50km options" />
          </div>
          <div class="form-field">
            <label for="wizard-registration">Registration URL</label>
            <input id="wizard-registration" type="url" {...bindText(registrationUrl, setRegistrationUrl)}
              placeholder="https://" />
          </div>
        </div>
        <WizardNav
          onBack={() => setStep(2)}
          onNext={() => setStep(4)}
          skipLabel="Skip for now"
          onSkip={() => skipStep('body', 4)}
        />
      </>
    );
  }

  function renderDetails() {
    return (
      <>
        <h2 class="wizard-step-heading">Add more details</h2>
        <p class="wizard-step-subheading">Tags, links, and extra info — all optional.</p>
        <div class="auth-form">
          <div class="form-field">
            <label>Tags</label>
            <TagEditor
              tags={tags}
              onTagsChange={setTags}
              knownTags={knownTags}
              tagTranslations={tagTranslations}
              activeLocale={defaultLocale}
              datalistId="wizard-event-tag-suggestions"
            />
          </div>
          <PhotoField
            photoKey={posterKey}
            cdnUrl={cdnUrl}
            label="Poster"
            onPhotoChange={(key, contentType, width, height) => {
              setPosterKey(key);
              setPosterContentType(contentType);
              setPosterWidth(width);
              setPosterHeight(height);
            }}
          />
          <div class="form-field">
            <label for="wizard-event-url">Event website</label>
            <input id="wizard-event-url" type="url" {...bindText(eventUrl, setEventUrl)}
              placeholder="https://" />
          </div>
          <div class="form-field">
            <label for="wizard-map-url">Map URL</label>
            <input id="wizard-map-url" type="url" {...bindText(mapUrl, setMapUrl)}
              placeholder="https://ridewithgps.com/..." />
          </div>
          <div class="form-field">
            <label for="wizard-edition">Edition</label>
            <input id="wizard-edition" type="text" {...bindText(edition, setEdition)}
              placeholder="e.g. 53rd, 2026" />
          </div>
          <div class="form-field">
            <label for="wizard-previous-event">Previous edition</label>
            <select id="wizard-previous-event" value={previousEvent}
              onChange={(e) => setPreviousEvent((e.target as HTMLSelectElement).value)}>
              <option value="">-- None --</option>
              {(() => {
                const byYear = new Map<string, typeof eventOptions>();
                for (const opt of eventOptions) {
                  const list = byYear.get(opt.year) || [];
                  list.push(opt);
                  byYear.set(opt.year, list);
                }
                for (const list of byYear.values()) {
                  list.sort((a, b) => b.id.localeCompare(a.id));
                }
                const years = [...byYear.keys()].sort((a, b) => b.localeCompare(a));
                if (years.length <= 1) {
                  return eventOptions
                    .sort((a, b) => b.id.localeCompare(a.id))
                    .map(opt => (
                      <option key={opt.id} value={opt.id}>{opt.name}</option>
                    ));
                }
                return years.map(year => (
                  <optgroup key={year} label={year}>
                    {byYear.get(year)!.map(opt => (
                      <option key={opt.id} value={opt.id}>{opt.name}</option>
                    ))}
                  </optgroup>
                ));
              })()}
            </select>
          </div>
        </div>
        <WizardNav
          onBack={() => setStep(3)}
          onNext={() => setStep(5)}
          skipLabel="Skip for now"
          onSkip={() => setStep(5)}
        />
      </>
    );
  }

  function renderOrganizer() {
    return (
      <>
        <h2 class="wizard-step-heading">Who's organizing this?</h2>
        <p class="wizard-step-subheading">Select an existing community or add a new one.</p>
        <div class="auth-form">
          <div class="form-field">
            <label>Organizer</label>
            <div class="organizer-select-row">
              <select
                value={orgSlug || (disclosure.isOpen('orgForm') && orgName ? '__custom__' : '')}
                onChange={(e) => {
                  const val = (e.target as HTMLSelectElement).value;
                  if (val === '__custom__') return;
                  selectOrganizer(val);
                }}
              >
                <option value="">-- None --</option>
                {disclosure.isOpen('orgForm') && orgName && !organizers.find(o => o.slug === orgSlug) && (
                  <option value="__custom__">{orgName} (custom)</option>
                )}
                {organizers.map(o => (
                  <option key={o.slug} value={o.slug}>{o.name}</option>
                ))}
              </select>
              <button type="button" class="btn-link" onClick={createNewOrganizer}>
                or create new
              </button>
            </div>
          </div>

          {disclosure.isOpen('orgForm') && (
            <div class="organizer-inline-form">
              <div class="form-field">
                <label for="wizard-org-name">Organizer name</label>
                <input id="wizard-org-name" type="text" {...bindText(orgName, setOrgName)} />
              </div>
              <div class="form-field">
                <label for="wizard-org-website">Website</label>
                <input id="wizard-org-website" type="url" {...bindText(orgWebsite, setOrgWebsite)} />
              </div>
              <div class="form-field">
                <label for="wizard-org-instagram">Instagram handle</label>
                <input id="wizard-org-instagram" type="text" {...bindText(orgInstagram, setOrgInstagram)}
                  placeholder="without @" />
              </div>
              <PhotoField
                photoKey={orgPhotoKey}
                cdnUrl={cdnUrl}
                label="Organizer photo"
                onPhotoChange={(key, contentType, width, height) => {
                  setOrgPhotoKey(key);
                  setOrgPhotoContentType(contentType);
                  setOrgPhotoWidth(width);
                  setOrgPhotoHeight(height);
                }}
              />
            </div>
          )}
        </div>
        <WizardNav
          onBack={() => setStep(4)}
          onNext={() => setStep(6)}
          nextDisabled={!orgName.trim()}
        />
      </>
    );
  }

  function renderReview() {
    return (
      <>
        <h2 class="wizard-step-heading">Here's how it'll look</h2>
        <p class="wizard-step-subheading">This is what people will see when they find your event.</p>
        <EventPreview
          name={name}
          startDate={startDate}
          startTime={startTime}
          endDate={endDate}
          endTime={endTime}
          meetTime={meetTime}
          location={location}
          organizer={orgName}
          distances={distances}
          registrationUrl={registrationUrl}
          eventUrl={eventUrl}
          posterKey={posterKey}
          tags={tags}
          body={body}
          cdnUrl={cdnUrl}
        />
        {userRole === 'guest' && guestLabel && <p class="editor-guest-label">{guestLabel}</p>}
        {editor.error && <div class="auth-error">{editor.error}</div>}
        {showLicenseNotice && (
          <p class="editor-license-notice">
            Your contribution will be shared under{' '}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>.
            {' '}<a href="https://whereto.bike/about/licensing/" target="_blank" rel="noopener">What does this mean?</a>
          </p>
        )}
        <WizardNav
          onBack={() => setStep(5)}
          onNext={editor.save}
          nextLabel={editor.saving ? 'Saving...' : 'Save'}
          nextDisabled={editor.saving}
        />
      </>
    );
  }

  const stepRenderers = [renderWelcome, renderPoster, renderWhenWhere, renderStory, renderDetails, renderOrganizer, renderReview];

  return (
    <div ref={hydratedRef}>
      <WizardLayout stops={STOPS} currentStep={step} onStepChange={setStep}>
        {stepRenderers[step]()}
      </WizardLayout>
    </div>
  );
}
