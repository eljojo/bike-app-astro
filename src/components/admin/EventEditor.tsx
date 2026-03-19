// AGENTS.md: See src/components/admin/AGENTS.md for editor rules.
// Key: textarea hydration workaround required, contentHash must sync after save, all styles in admin.scss.
import { useCallback, useState, useRef, useEffect } from 'preact/hooks';
import { useUnsavedGuard } from '../../lib/hooks/use-unsaved-guard';
import { useEditorState } from './useEditorState';
import { useProgressiveDisclosure } from './useProgressiveDisclosure';
import { useFormValidation } from './useFormValidation';
import MarkdownEditor from './MarkdownEditor';
import EditorActions from './EditorActions';
import PhotoField from './PhotoField';
import type { MediaItem } from './MediaManager';
import EventRouteSection from './EventRouteSection';
import EventMediaSection from './EventMediaSection';
import WaypointEditor from './WaypointEditor';
import type { Waypoint } from './WaypointEditor';
import ResultsEditor from './ResultsEditor';
import type { Result } from './ResultsEditor';
import SeriesEditor from './SeriesEditor';
import type { EventDetail, EventSeries } from '../../lib/models/event-model';
import { slugify } from '../../lib/slug';
import type { EventUpdate } from '../../views/api/event-save'; // type-only import: compile-time check, no runtime bundle impact
import type { AdminOrganizer, RouteOption } from '../../types/admin';

interface Props {
  initialData: EventDetail & { contentHash?: string; isNew?: boolean };
  organizers: AdminOrganizer[];
  cdnUrl: string;
  readOnly?: boolean;
  userRole?: string;
  showLicenseNotice?: boolean;
  isClub?: boolean;
  routeOptions?: RouteOption[];
  placeOptions?: Array<{ id: string; name: string }>;
  eventOptions?: Array<{ id: string; name: string; year: string }>;
  tagTranslations?: Record<string, Record<string, string>>;
  knownTags?: string[];
  defaultLocale?: string;
}

/** Resolve the initial organizer state from the union field */
function resolveOrganizer(
  organizer: EventDetail['organizer'],
  allOrganizers: AdminOrganizer[],
) {
  if (!organizer) return { slug: '', name: '', website: '', instagram: '', photoKey: '', photoContentType: '', photoWidth: undefined as number | undefined, photoHeight: undefined as number | undefined, isRef: false };

  if (typeof organizer === 'string') {
    const org = allOrganizers.find(o => o.slug === organizer);
    return {
      slug: organizer,
      name: org?.name || organizer,
      website: org?.website || '',
      instagram: org?.instagram || '',
      photoKey: org?.photo_key || '',
      photoContentType: org?.photo_content_type || '',
      photoWidth: org?.photo_width,
      photoHeight: org?.photo_height,
      isRef: true,
    };
  }

  // Inline object
  return {
    slug: '',
    name: organizer.name,
    website: organizer.website || '',
    instagram: organizer.instagram || '',
    photoKey: organizer.photo_key || '',
    photoContentType: organizer.photo_content_type || '',
    photoWidth: organizer.photo_width,
    photoHeight: organizer.photo_height,
    isRef: false,
  };
}

export default function EventEditor({ initialData, organizers, cdnUrl, readOnly, userRole, showLicenseNotice, isClub, routeOptions = [], placeOptions = [], eventOptions = [], tagTranslations = {}, knownTags = [], defaultLocale = '' }: Props) {
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty);

  const [name, setName] = useState(initialData.name);
  const [startDate, setStartDate] = useState(initialData.start_date);
  const [startTime, setStartTime] = useState(initialData.start_time || '');
  const [meetTime, setMeetTime] = useState(initialData.meet_time || '');
  const [endDate, setEndDate] = useState(initialData.end_date || '');
  const [endTime, setEndTime] = useState(initialData.end_time || '');
  const [seriesMode, setSeriesMode] = useState<boolean>(!!initialData.series);
  const [seriesData, setSeriesData] = useState<EventSeries | undefined>(initialData.series);
  const [registrationUrl, setRegistrationUrl] = useState(initialData.registration_url || '');
  const [distances, setDistances] = useState(initialData.distances || '');
  const [location, setLocation] = useState(initialData.location || '');
  const [reviewUrl, setReviewUrl] = useState(initialData.review_url || '');
  const [edition, setEdition] = useState(initialData.edition || '');
  const [eventUrl, setEventUrl] = useState(initialData.event_url || '');
  const [mapUrl, setMapUrl] = useState(initialData.map_url || '');
  const [previousEvent, setPreviousEvent] = useState(initialData.previous_event || '');
  const [posterKey, setPosterKey] = useState(initialData.poster_key || '');
  const [posterContentType, setPosterContentType] = useState(initialData.poster_content_type || '');
  const [posterWidth, setPosterWidth] = useState<number | undefined>(initialData.poster_width);
  const [posterHeight, setPosterHeight] = useState<number | undefined>(initialData.poster_height);
  const [tags, setTags] = useState<string[]>(initialData.tags || []);
  const [tagInput, setTagInput] = useState('');
  const [body, setBody] = useState(initialData.body);

  // Club-specific state
  const [selectedRoutes, setSelectedRoutes] = useState<string[]>(initialData.routes || []);
  const [media, setMedia] = useState<MediaItem[]>(
    (initialData.media || []).map(m => ({
      key: m.key,
      ...(m.caption != null && { caption: m.caption }),
      ...(m.cover != null && { cover: m.cover }),
      ...(m.width != null && { width: m.width }),
      ...(m.height != null && { height: m.height }),
      ...(m.lat != null && { lat: m.lat }),
      ...(m.lng != null && { lng: m.lng }),
    }))
  );
  const [waypoints, setWaypoints] = useState<Waypoint[]>(
    (initialData.waypoints || []).map(w => ({
      place: w.place,
      type: w.type,
      label: w.label,
      ...(w.distance_km != null && { distance_km: w.distance_km }),
      ...(w.opening && { opening: w.opening }),
      ...(w.closing && { closing: w.closing }),
      ...(w.route && { route: w.route }),
      ...(w.note && { note: w.note }),
    }))
  );
  const [eventResults, setEventResults] = useState<Result[]>(
    (initialData.results || []).map(r => ({
      last_name: r.last_name,
      ...(r.brevet_no != null && { brevet_no: r.brevet_no }),
      ...(r.first_name && { first_name: r.first_name }),
      ...(r.time && { time: r.time }),
      ...(r.homologation && { homologation: r.homologation }),
      ...(r.status && { status: r.status }),
    }))
  );

  // Organizer state
  const initOrg = resolveOrganizer(initialData.organizer, organizers);
  const [orgSlug, setOrgSlug] = useState(initOrg.slug);
  const [orgName, setOrgName] = useState(initOrg.name);
  const [orgWebsite, setOrgWebsite] = useState(initOrg.website);
  const [orgInstagram, setOrgInstagram] = useState(initOrg.instagram);
  const [orgPhotoKey, setOrgPhotoKey] = useState(initOrg.photoKey);
  const [orgPhotoContentType, setOrgPhotoContentType] = useState(initOrg.photoContentType);
  const [orgPhotoWidth, setOrgPhotoWidth] = useState<number | undefined>(initOrg.photoWidth);
  const [orgPhotoHeight, setOrgPhotoHeight] = useState<number | undefined>(initOrg.photoHeight);
  const [isExistingRef, setIsExistingRef] = useState(initOrg.isRef);

  const initialRender = useRef(true);
  useEffect(() => {
    if (initialRender.current) { initialRender.current = false; return; }
    setDirty(true);
  }, [name, startDate, startTime, meetTime, endDate, endTime, registrationUrl, distances, location, reviewUrl, edition, eventUrl, mapUrl, previousEvent, posterKey, posterContentType, tags, body, selectedRoutes, media, waypoints, eventResults, orgSlug, orgName, orgWebsite, orgInstagram, orgPhotoKey, seriesMode, seriesData]);

  // Progressive disclosure — show fields when data exists or user clicks link
  const disclosure = useProgressiveDisclosure({
    time: !!(initialData.start_time || initialData.end_time || initialData.meet_time),
    meetTime: !!initialData.meet_time,
    endDate: !!initialData.end_date,
    endTime: !!initialData.end_time,
    location: !!initialData.location,
    distances: !!initialData.distances,
    registration: !!initialData.registration_url,
    review: !!initialData.review_url,
    edition: !!initialData.edition,
    eventUrl: !!initialData.event_url,
    mapUrl: !!initialData.map_url,
    previousEvent: !!initialData.previous_event,
    orgForm: initOrg.name !== '',
  });

  const { validate } = useFormValidation([
    { field: 'event-name', check: () => !name.trim(), message: 'Name is required' },
    { field: 'event-start-date', check: () => !seriesMode && !startDate, message: 'Start date is required' },
    { field: 'series-season-start', check: () => seriesMode && !startDate, message: 'Series needs at least one occurrence' },
  ]);

  // Save state
  const { saving, saved, error, githubUrl, save: handleSave } = useEditorState({
    apiBase: '/api/events',
    contentId: initialData.isNew ? null : initialData.id,
    initialContentHash: initialData.contentHash,
    userRole,
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
          ...(registrationUrl && { registration_url: registrationUrl }),
          ...(distances && { distances }),
          ...(location && { location }),
          ...(reviewUrl && { review_url: reviewUrl }),
          ...(edition && { edition }),
          ...(eventUrl && { event_url: eventUrl }),
          ...(mapUrl && { map_url: mapUrl }),
          ...(previousEvent && { previous_event: previousEvent }),
          ...(posterKey && { poster_key: posterKey, poster_content_type: posterContentType || 'image/jpeg', ...(posterWidth && { poster_width: posterWidth }), ...(posterHeight && { poster_height: posterHeight }) }),
          ...(tags.length > 0 && { tags }),
          ...(isClub && selectedRoutes.length > 0 && { routes: selectedRoutes }),
          ...(isClub && waypoints.length > 0 && { waypoints }),
          ...(isClub && eventResults.length > 0 && { results: eventResults }),
        },
        body,
        ...(media.length > 0 && { media }),
      };
      if (disclosure.isOpen('orgForm') && orgName) {
        payload.organizer = {
          slug: orgSlug || slugify(orgName),
          name: orgName,
          ...(orgWebsite && { website: orgWebsite }),
          ...(orgInstagram && { instagram: orgInstagram }),
          ...(orgPhotoKey && { photo_key: orgPhotoKey, photo_content_type: orgPhotoContentType || 'image/jpeg', ...(orgPhotoWidth && { photo_width: orgPhotoWidth }), ...(orgPhotoHeight && { photo_height: orgPhotoHeight }) }),
          isExistingRef,
        };
      }
      return payload as unknown as Record<string, unknown>;
    },
    onSuccess: (result) => {
      setDirty(false);
      if (initialData.isNew && result.id) {
        window.location.href = `/admin/events/${result.id}`;
      }
    },
  });

  const handleSeriesChange = useCallback((series: EventSeries | undefined, firstDate: string, lastDate: string) => {
    setSeriesData(series);
    if (firstDate) setStartDate(firstDate);
    if (lastDate) setEndDate(lastDate);
  }, []);

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

  const activeLocale = defaultLocale; // events don't have per-editor locale switching

  function displayTag(tag: string): string {
    return tagTranslations[tag]?.[activeLocale] ?? tag;
  }

  function resolveTag(input: string): string {
    if (knownTags.includes(input)) return input;
    for (const [key, locales] of Object.entries(tagTranslations)) {
      for (const translated of Object.values(locales)) {
        if (translated.toLowerCase() === input) return key;
      }
    }
    return input;
  }

  function addTag() {
    const raw = tagInput.trim().toLowerCase();
    if (!raw) { setTagInput(''); return; }
    const tag = resolveTag(raw);
    if (!tags.includes(tag)) {
      setTags([...tags, tag]);
    }
    setTagInput('');
  }

  function removeTag(tag: string) {
    setTags(tags.filter(t => t !== tag));
  }

  function handleTagKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag();
    }
  }

  return (
    <fieldset class="event-editor" disabled={readOnly}>
        <div class="auth-form">
          <div class="form-field">
            <label for="event-name">Name</label>
            <input id="event-name" type="text" value={name}
              onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          </div>

          <div class="form-field">
            <label>Tags</label>
            <div class="tag-editor">
              {tags.map((tag) => (
                <span key={tag} class="tag-pill">
                  {displayTag(tag)}
                  <button type="button" onClick={() => removeTag(tag)}>{'×'}</button>
                </span>
              ))}
              <input
                type="text"
                class="tag-input"
                list="event-tag-suggestions"
                value={tagInput}
                onInput={(e) => setTagInput((e.target as HTMLInputElement).value)}
                onKeyDown={handleTagKeyDown}
                onBlur={addTag}
                placeholder="Add tag..."
              />
              <datalist id="event-tag-suggestions">
                {knownTags
                  .filter(t => !tags.includes(t))
                  .flatMap(tag => {
                    const options = [<option key={tag} value={tag} />];
                    const locales = tagTranslations[tag];
                    if (locales) {
                      for (const [locale, translated] of Object.entries(locales)) {
                        options.push(<option key={`${tag}-${locale}`} value={translated} />);
                      }
                    }
                    return options;
                  })}
              </datalist>
            </div>
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

          {/* Normal mode: date fields */}
          {!seriesMode && (
            <>
              <div class="form-field">
                <label for="event-start-date">{disclosure.isOpen('endDate') ? 'Start date' : 'Date'}</label>
                <input id="event-start-date" type="date" value={startDate}
                  onInput={(e) => setStartDate((e.target as HTMLInputElement).value)} />
              </div>

              {disclosure.isOpen('time') && (
                <div class="form-field">
                  <label for="event-start-time">{disclosure.isOpen('endDate') ? 'Start time' : 'Time'}</label>
                  <input id="event-start-time" type="time" value={startTime}
                    onInput={(e) => setStartTime((e.target as HTMLInputElement).value)} />
                </div>
              )}

              {disclosure.isOpen('time') && disclosure.isOpen('meetTime') && (
                <div class="form-field">
                  <label for="event-meet-time">Meet time</label>
                  <input id="event-meet-time" type="time" value={meetTime}
                    onInput={(e) => setMeetTime((e.target as HTMLInputElement).value)} />
                </div>
              )}

              {disclosure.isOpen('endTime') && !disclosure.isOpen('endDate') && (
                <div class="form-field">
                  <label for="event-end-time">End time</label>
                  <input id="event-end-time" type="time" value={endTime}
                    onInput={(e) => setEndTime((e.target as HTMLInputElement).value)} />
                </div>
              )}

              {disclosure.isOpen('endDate') && (
                <>
                  <div class="form-field">
                    <label for="event-end-date">End date</label>
                    <input id="event-end-date" type="date" value={endDate}
                      onInput={(e) => setEndDate((e.target as HTMLInputElement).value)} />
                  </div>
                  {disclosure.isOpen('endTime') && (
                    <div class="form-field">
                      <label for="event-end-time">End time</label>
                      <input id="event-end-time" type="time" value={endTime}
                        onInput={(e) => setEndTime((e.target as HTMLInputElement).value)} />
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
                    if (!endDate) {
                      const next = new Date(startDate);
                      next.setDate(next.getDate() + 1);
                      setEndDate(next.toISOString().split('T')[0]);
                    }
                  }}>Ends on a different day</button>
                )}
              </div>
            </>
          )}

          {/* Series mode: time fields + series editor */}
          {seriesMode && (
            <>
              <div class="disclosure-links">
                {!disclosure.isOpen('time') && (
                  <button type="button" class="btn-link" onClick={() => disclosure.open('time')}>Set time</button>
                )}
              </div>

              {disclosure.isOpen('time') && (
                <div class="form-field">
                  <label for="event-start-time">Time</label>
                  <input id="event-start-time" type="time" value={startTime}
                    onInput={(e) => setStartTime((e.target as HTMLInputElement).value)} />
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
                  <label for="event-meet-time">Meet time</label>
                  <input id="event-meet-time" type="time" value={meetTime}
                    onInput={(e) => setMeetTime((e.target as HTMLInputElement).value)} />
                </div>
              )}

              <SeriesEditor
                initialSeries={initialData.series}
                eventLocation={location}
                eventStartTime={startTime}
                eventMeetTime={meetTime}
                locale={activeLocale}
                onSeriesChange={handleSeriesChange}
              />
            </>
          )}

          {disclosure.isOpen('location') && (
            <div class="form-field">
              <label for="event-location">Location</label>
              <input id="event-location" type="text" value={location}
                placeholder="111 Wellington St, K1A 0A6"
                onInput={(e) => setLocation((e.target as HTMLInputElement).value)} />
            </div>
          )}

          {disclosure.isOpen('distances') && (
            <div class="form-field">
              <label for="event-distances">Distances</label>
              <input id="event-distances" type="text" value={distances}
                placeholder="e.g. 10km loop, 25km and 50km options"
                onInput={(e) => setDistances((e.target as HTMLInputElement).value)} />
            </div>
          )}

          {disclosure.isOpen('registration') && (
            <div class="form-field">
              <label for="event-registration">Registration URL</label>
              <input id="event-registration" type="url" value={registrationUrl}
                placeholder="https://"
                onInput={(e) => setRegistrationUrl((e.target as HTMLInputElement).value)} />
            </div>
          )}

          {disclosure.isOpen('review') && (
            <div class="form-field">
              <label for="event-review">Review URL</label>
              <input id="event-review" type="url" value={reviewUrl}
                placeholder="https://"
                onInput={(e) => setReviewUrl((e.target as HTMLInputElement).value)} />
            </div>
          )}

          <div class="disclosure-links">
            {!disclosure.isOpen('location') && (
              <button type="button" class="btn-link" onClick={() => disclosure.open('location')}>Add location</button>
            )}
            {!disclosure.isOpen('distances') && (
              <button type="button" class="btn-link" onClick={() => disclosure.open('distances')}>Add distance info</button>
            )}
            {!disclosure.isOpen('registration') && (
              <button type="button" class="btn-link" onClick={() => disclosure.open('registration')}>Add registration link</button>
            )}
            {!disclosure.isOpen('review') && (
              <button type="button" class="btn-link" onClick={() => disclosure.open('review')}>Add review link</button>
            )}
          </div>

          <div class="disclosure-links">
            {!disclosure.isOpen('edition') && (
              <button type="button" class="btn-link" onClick={() => disclosure.open('edition')}>Add edition info</button>
            )}
            {!disclosure.isOpen('eventUrl') && (
              <button type="button" class="btn-link" onClick={() => disclosure.open('eventUrl')}>Add event website</button>
            )}
            {!disclosure.isOpen('mapUrl') && (
              <button type="button" class="btn-link" onClick={() => disclosure.open('mapUrl')}>Add map link</button>
            )}
            {!disclosure.isOpen('previousEvent') && (
              <button type="button" class="btn-link" onClick={() => disclosure.open('previousEvent')}>Link previous edition</button>
            )}
          </div>

          {disclosure.isOpen('edition') && (
            <div class="form-field">
              <label for="event-edition">Edition</label>
              <input id="event-edition" type="text" value={edition}
                placeholder="e.g. 53rd, 2026"
                onInput={(e) => setEdition((e.target as HTMLInputElement).value)} />
            </div>
          )}

          {disclosure.isOpen('eventUrl') && (
            <div class="form-field">
              <label for="event-url">Event website</label>
              <input id="event-url" type="url" value={eventUrl}
                placeholder="https://"
                onInput={(e) => setEventUrl((e.target as HTMLInputElement).value)} />
            </div>
          )}

          {disclosure.isOpen('mapUrl') && (
            <div class="form-field">
              <label for="event-map-url">Map URL</label>
              <input id="event-map-url" type="url" value={mapUrl}
                placeholder="https://ridewithgps.com/..."
                onInput={(e) => setMapUrl((e.target as HTMLInputElement).value)} />
            </div>
          )}

          {disclosure.isOpen('previousEvent') && (
            <div class="form-field">
              <label for="event-previous">Previous edition</label>
              <select id="event-previous" value={previousEvent}
                onChange={(e) => setPreviousEvent((e.target as HTMLSelectElement).value)}>
                <option value="">-- None --</option>
                {(() => {
                  const opts = eventOptions ?? [];

                  // Group events by year, newest first; within each year, newest first
                  const byYear = new Map<string, typeof opts>();
                  for (const opt of opts) {
                    const list = byYear.get(opt.year) || [];
                    list.push(opt);
                    byYear.set(opt.year, list);
                  }
                  for (const list of byYear.values()) {
                    list.sort((a, b) => b.id.localeCompare(a.id));
                  }
                  const years = [...byYear.keys()].sort((a, b) => b.localeCompare(a));

                  if (years.length <= 1) {
                    return opts
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
          )}

          <div class="form-field">
            <label for="event-body">Description (markdown)</label>
            <MarkdownEditor
              id="event-body"
              value={body}
              onChange={setBody}
              rows={6}
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
        </div>

      {isClub && routeOptions.length > 0 && (
        <EventRouteSection
          routeOptions={routeOptions}
          selectedRoutes={selectedRoutes}
          onRoutesChange={setSelectedRoutes}
        />
      )}

      <EventMediaSection
        media={media}
        onMediaChange={setMedia}
        cdnUrl={cdnUrl}
        userRole={userRole}
      />

      {isClub && placeOptions.length > 0 && (
        <section class="editor-section">
          <h2>Waypoints</h2>
          <WaypointEditor
            waypoints={waypoints}
            onChange={setWaypoints}
            places={placeOptions}
            routes={selectedRoutes.length > 1 ? selectedRoutes : undefined}
          />
        </section>
      )}

      {isClub && (
        <section class="editor-section">
          <h2>Results</h2>
          <ResultsEditor
            results={eventResults}
            onChange={setEventResults}
          />
        </section>
      )}

      <section class="editor-section">
        <h2>Organizer</h2>
        <div class="auth-form">
          <div class="form-field">
            <label>Select organizer</label>
            <div class="organizer-select-row">
              <select value={orgSlug || (disclosure.isOpen('orgForm') && orgName ? '__custom__' : '')}
                onChange={(e) => {
                  const val = (e.target as HTMLSelectElement).value;
                  if (val === '__custom__') return;
                  selectOrganizer(val);
                }}>
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
                <label for="org-name">Organizer Name</label>
                <input id="org-name" type="text" value={orgName}
                  onInput={(e) => setOrgName((e.target as HTMLInputElement).value)} />
              </div>
              <div class="form-field">
                <label for="org-website">Website</label>
                <input id="org-website" type="url" value={orgWebsite}
                  onInput={(e) => setOrgWebsite((e.target as HTMLInputElement).value)} />
              </div>
              <div class="form-field">
                <label for="org-instagram">Instagram handle</label>
                <input id="org-instagram" type="text" value={orgInstagram}
                  placeholder="without @"
                  onInput={(e) => setOrgInstagram((e.target as HTMLInputElement).value)} />
              </div>
              <PhotoField
                photoKey={orgPhotoKey}
                cdnUrl={cdnUrl}
                label="Photo"
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
      </section>

      <EditorActions
        error={error} githubUrl={githubUrl} saved={saved} saving={saving}
        onSave={handleSave} contentType="event" userRole={userRole}
        viewLink={`/events/${initialData.id}`}
        showLicenseNotice={showLicenseNotice !== false}
        licenseDocsUrl="https://whereto.bike/about/licensing/"
        disabled={readOnly}
      />
    </fieldset>
  );
}
