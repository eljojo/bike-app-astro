// AGENTS.md: See src/components/admin/AGENTS.md for editor rules.
// Key: textarea hydration workaround required, contentHash must sync after save, all styles in admin.scss.
import { useState } from 'preact/hooks';
import { useEditorState } from './useEditorState';
import MarkdownEditor from './MarkdownEditor';
import PhotoField from './PhotoField';
import type { MediaItem } from './MediaManager';
import EventRouteSection from './EventRouteSection';
import EventMediaSection from './EventMediaSection';
import WaypointEditor from './WaypointEditor';
import type { Waypoint } from './WaypointEditor';
import ResultsEditor from './ResultsEditor';
import type { Result } from './ResultsEditor';
import SaveSuccessModal from './SaveSuccessModal';
import type { EventDetail } from '../../lib/models/event-model';
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
}

/** Resolve the initial organizer state from the union field */
function resolveOrganizer(
  organizer: EventDetail['organizer'],
  allOrganizers: AdminOrganizer[],
) {
  if (!organizer) return { slug: '', name: '', website: '', instagram: '', isRef: false };

  if (typeof organizer === 'string') {
    const org = allOrganizers.find(o => o.slug === organizer);
    return {
      slug: organizer,
      name: org?.name || organizer,
      website: org?.website || '',
      instagram: org?.instagram || '',
      isRef: true,
    };
  }

  // Inline object
  return {
    slug: '',
    name: organizer.name,
    website: organizer.website || '',
    instagram: organizer.instagram || '',
    isRef: false,
  };
}

export default function EventEditor({ initialData, organizers, cdnUrl, readOnly, userRole, showLicenseNotice, isClub, routeOptions = [], placeOptions = [] }: Props) {
  const [name, setName] = useState(initialData.name);
  const [startDate, setStartDate] = useState(initialData.start_date);
  const [startTime, setStartTime] = useState(initialData.start_time || '');
  const [endDate, setEndDate] = useState(initialData.end_date || '');
  const [endTime, setEndTime] = useState(initialData.end_time || '');
  const [registrationUrl, setRegistrationUrl] = useState(initialData.registration_url || '');
  const [distances, setDistances] = useState(initialData.distances || '');
  const [location, setLocation] = useState(initialData.location || '');
  const [reviewUrl, setReviewUrl] = useState(initialData.review_url || '');
  const [posterKey, setPosterKey] = useState(initialData.poster_key || '');
  const [posterContentType, setPosterContentType] = useState(initialData.poster_content_type || '');
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

  // Progressive disclosure — show fields when data exists or user clicks link
  const [showTime, setShowTime] = useState(!!(initialData.start_time || initialData.end_time));
  const [showEndDate, setShowEndDate] = useState(!!initialData.end_date);
  const [showEndTime, setShowEndTime] = useState(!!initialData.end_time);
  const [showLocation, setShowLocation] = useState(!!initialData.location);
  const [showDistances, setShowDistances] = useState(!!initialData.distances);
  const [showRegistration, setShowRegistration] = useState(!!initialData.registration_url);
  const [showReview, setShowReview] = useState(!!initialData.review_url);

  // Organizer state
  const initOrg = resolveOrganizer(initialData.organizer, organizers);
  const [orgSlug, setOrgSlug] = useState(initOrg.slug);
  const [orgName, setOrgName] = useState(initOrg.name);
  const [orgWebsite, setOrgWebsite] = useState(initOrg.website);
  const [orgInstagram, setOrgInstagram] = useState(initOrg.instagram);
  const [showOrgForm, setShowOrgForm] = useState(initOrg.name !== '');

  // Save state
  const { saving, saved, error, githubUrl, save: handleSave } = useEditorState({
    apiBase: '/api/events',
    contentId: initialData.isNew ? null : initialData.id,
    initialContentHash: initialData.contentHash,
    userRole,
    validate: () => {
      if (!name.trim()) {
        document.getElementById('event-name')?.focus();
        return 'Name is required';
      }
      if (!startDate) {
        document.getElementById('event-start-date')?.focus();
        return 'Start date is required';
      }
      return null;
    },
    buildPayload: () => {
      const payload: EventUpdate = {
        frontmatter: {
          name,
          start_date: startDate,
          ...(startTime && { start_time: startTime }),
          ...(endDate && { end_date: endDate }),
          ...(endTime && { end_time: endTime }),
          ...(registrationUrl && { registration_url: registrationUrl }),
          ...(distances && { distances }),
          ...(location && { location }),
          ...(reviewUrl && { review_url: reviewUrl }),
          ...(posterKey && { poster_key: posterKey, poster_content_type: posterContentType || 'image/jpeg' }),
          ...(isClub && selectedRoutes.length > 0 && { routes: selectedRoutes }),
          ...(isClub && waypoints.length > 0 && { waypoints }),
          ...(isClub && eventResults.length > 0 && { results: eventResults }),
        },
        body,
        ...(media.length > 0 && { media }),
      };
      if (showOrgForm && orgName) {
        payload.organizer = {
          slug: orgSlug || slugify(orgName),
          name: orgName,
          ...(orgWebsite && { website: orgWebsite }),
          ...(orgInstagram && { instagram: orgInstagram }),
        };
      }
      return payload as unknown as Record<string, unknown>;
    },
    onSuccess: (result) => {
      if (initialData.isNew && result.id) {
        window.location.href = `/admin/events/${result.id}`;
      }
    },
  });

  function selectOrganizer(slug: string) {
    setOrgSlug(slug);
    const org = organizers.find(o => o.slug === slug);
    if (org) {
      setOrgName(org.name);
      setOrgWebsite(org.website || '');
      setOrgInstagram(org.instagram || '');
      setShowOrgForm(true);
    } else {
      setOrgName('');
      setOrgWebsite('');
      setOrgInstagram('');
      setShowOrgForm(false);
    }
  }

  function createNewOrganizer() {
    setOrgSlug('');
    setOrgName('');
    setOrgWebsite('');
    setOrgInstagram('');
    setShowOrgForm(true);
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
            <label for="event-start-date">{showEndDate ? 'Start date' : 'Date'}</label>
            <input id="event-start-date" type="date" value={startDate}
              onInput={(e) => setStartDate((e.target as HTMLInputElement).value)} />
          </div>

          {showTime && (
            <div class="form-field">
              <label for="event-start-time">{showEndDate ? 'Start time' : 'Time'}</label>
              <input id="event-start-time" type="time" value={startTime}
                onInput={(e) => setStartTime((e.target as HTMLInputElement).value)} />
            </div>
          )}

          {showEndTime && !showEndDate && (
            <div class="form-field">
              <label for="event-end-time">End time</label>
              <input id="event-end-time" type="time" value={endTime}
                onInput={(e) => setEndTime((e.target as HTMLInputElement).value)} />
            </div>
          )}

          {showEndDate && (
            <>
              <div class="form-field">
                <label for="event-end-date">End date</label>
                <input id="event-end-date" type="date" value={endDate}
                  onInput={(e) => setEndDate((e.target as HTMLInputElement).value)} />
              </div>
              {showEndTime && (
                <div class="form-field">
                  <label for="event-end-time">End time</label>
                  <input id="event-end-time" type="time" value={endTime}
                    onInput={(e) => setEndTime((e.target as HTMLInputElement).value)} />
                </div>
              )}
            </>
          )}

          <div class="disclosure-links">
            {!showTime && (
              <button type="button" class="btn-link" onClick={() => setShowTime(true)}>Set time</button>
            )}
            {showTime && !showEndTime && (
              <button type="button" class="btn-link" onClick={() => setShowEndTime(true)}>Set end time</button>
            )}
            {!showEndDate && (
              <button type="button" class="btn-link" onClick={() => {
                setShowEndDate(true);
                if (!endDate) {
                  const next = new Date(startDate);
                  next.setDate(next.getDate() + 1);
                  setEndDate(next.toISOString().split('T')[0]);
                }
              }}>Ends on a different day</button>
            )}
          </div>

          {showLocation && (
            <div class="form-field">
              <label for="event-location">Location</label>
              <input id="event-location" type="text" value={location}
                placeholder="111 Wellington St, K1A 0A6"
                onInput={(e) => setLocation((e.target as HTMLInputElement).value)} />
            </div>
          )}

          {showDistances && (
            <div class="form-field">
              <label for="event-distances">Distances</label>
              <input id="event-distances" type="text" value={distances}
                placeholder="e.g. 10km loop, 25km and 50km options"
                onInput={(e) => setDistances((e.target as HTMLInputElement).value)} />
            </div>
          )}

          {showRegistration && (
            <div class="form-field">
              <label for="event-registration">Registration URL</label>
              <input id="event-registration" type="url" value={registrationUrl}
                placeholder="https://"
                onInput={(e) => setRegistrationUrl((e.target as HTMLInputElement).value)} />
            </div>
          )}

          {showReview && (
            <div class="form-field">
              <label for="event-review">Review URL</label>
              <input id="event-review" type="url" value={reviewUrl}
                placeholder="https://"
                onInput={(e) => setReviewUrl((e.target as HTMLInputElement).value)} />
            </div>
          )}

          <div class="disclosure-links">
            {!showLocation && (
              <button type="button" class="btn-link" onClick={() => setShowLocation(true)}>Add location</button>
            )}
            {!showDistances && (
              <button type="button" class="btn-link" onClick={() => setShowDistances(true)}>Add distance info</button>
            )}
            {!showRegistration && (
              <button type="button" class="btn-link" onClick={() => setShowRegistration(true)}>Add registration link</button>
            )}
            {!showReview && (
              <button type="button" class="btn-link" onClick={() => setShowReview(true)}>Add review link</button>
            )}
          </div>

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
            onPhotoChange={(key, contentType) => {
              setPosterKey(key);
              setPosterContentType(contentType);
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
              <select value={orgSlug || (showOrgForm && orgName ? '__custom__' : '')}
                onChange={(e) => {
                  const val = (e.target as HTMLSelectElement).value;
                  if (val === '__custom__') return;
                  selectOrganizer(val);
                }}>
                <option value="">-- None --</option>
                {showOrgForm && orgName && !organizers.find(o => o.slug === orgSlug) && (
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

          {showOrgForm && (
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
            </div>
          )}
        </div>
      </section>

      <div class="editor-actions">
        {error && !githubUrl && <div class="auth-error">{error}</div>}
        {githubUrl && (
          <div class="conflict-notice">
            <strong>Save blocked -- this event was changed on GitHub</strong>
            <p>Someone modified this event since you started editing.</p>
            <a href={githubUrl} target="_blank" rel="noopener" class="btn-primary"
              style="display: inline-block; margin-top: 0.5rem; text-decoration: none;">
              View file on GitHub
            </a>
          </div>
        )}
        {saved && userRole === 'guest' && (
          <SaveSuccessModal viewLink={`/events/${initialData.id}`} />
        )}
        {saved && userRole !== 'guest' && (
          <div class="save-success">
            Saved! Your edit will be live in a few minutes.
            {' '}<a href={`/events/${initialData.id}`}>View live</a>
          </div>
        )}
        {showLicenseNotice !== false && (
          <p class="editor-license-notice">
            By saving, you agree to release your contribution under{' '}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>.
          </p>
        )}
        <button type="button" class="btn-primary" onClick={handleSave} disabled={saving || readOnly}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </fieldset>
  );
}
