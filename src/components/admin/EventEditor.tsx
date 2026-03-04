import { useState, useRef, useEffect } from 'preact/hooks';
import { useTextareaValue, useFileUpload } from '../../lib/hooks';

interface OrganizerData {
  slug: string;
  name: string;
  website?: string;
  instagram?: string;
}

interface OrganizerInline {
  name: string;
  website?: string;
  instagram?: string;
}

interface EventData {
  id: string;
  slug: string;
  year: string;
  name: string;
  start_date: string;
  start_time?: string;
  end_date?: string;
  end_time?: string;
  registration_url?: string;
  distances?: string;
  location?: string;
  review_url?: string;
  organizer?: string | OrganizerInline;
  poster_key?: string;
  poster_content_type?: string;
  body: string;
  contentHash?: string;
  isNew?: boolean;
}

interface Props {
  initialData: EventData;
  organizers: OrganizerData[];
  cdnUrl: string;
  readOnly?: boolean;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Resolve the initial organizer state from the union field */
function resolveOrganizer(
  organizer: string | OrganizerInline | undefined,
  allOrganizers: OrganizerData[],
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

export default function EventEditor({ initialData, organizers, cdnUrl, readOnly }: Props) {
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
  const bodyRef = useTextareaValue(body);

  // Progressive disclosure — show fields when data exists or user clicks link
  const [showTime, setShowTime] = useState(!!(initialData.start_time || initialData.end_time));
  const [showEndDate, setShowEndDate] = useState(!!initialData.end_date);
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

  // Poster upload
  const posterUpload = useFileUpload();
  const posterInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const dropHandlerRef = useRef<(file: File) => void>(() => {});

  // Save state
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [githubUrl, setGithubUrl] = useState('');

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

  async function uploadPoster(file: File) {
    setError('');
    const results = await posterUpload.upload(file);
    if (results.length > 0) {
      setPosterKey(results[0].key);
      setPosterContentType(results[0].contentType || file.type);
    } else if (posterUpload.error) {
      setError(posterUpload.error);
    }
  }

  // Full-page drag-and-drop for poster upload
  dropHandlerRef.current = (file: File) => uploadPoster(file);

  useEffect(() => {
    function handleDragEnter(e: DragEvent) {
      e.preventDefault();
      dragCounterRef.current++;
      if (e.dataTransfer?.types.includes('Files')) {
        setDragging(true);
      }
    }
    function handleDragLeave(e: DragEvent) {
      e.preventDefault();
      dragCounterRef.current--;
      if (dragCounterRef.current === 0) {
        setDragging(false);
      }
    }
    function handleDragOver(e: DragEvent) {
      e.preventDefault();
    }
    function handleDrop(e: DragEvent) {
      e.preventDefault();
      dragCounterRef.current = 0;
      setDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('image/')) {
        dropHandlerRef.current(file);
      }
    }
    document.addEventListener('dragenter', handleDragEnter);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDrop);
    return () => {
      document.removeEventListener('dragenter', handleDragEnter);
      document.removeEventListener('dragleave', handleDragLeave);
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('drop', handleDrop);
    };
  }, []);

  async function handleSave() {
    setError('');
    setGithubUrl('');
    setSaving(true);
    setSaved(false);

    try {
      const payload: Record<string, unknown> = {
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
        },
        body,
        contentHash: initialData.contentHash,
      };

      // Include organizer data if set
      if (showOrgForm && orgName) {
        payload.organizer = {
          slug: orgSlug || slugify(orgName),
          name: orgName,
          ...(orgWebsite && { website: orgWebsite }),
          ...(orgInstagram && { instagram: orgInstagram }),
        };
      }

      const url = initialData.isNew
        ? '/api/events/new'
        : `/api/events/${initialData.id}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        if (res.status === 409 && data.conflict) {
          setError(data.error);
          setGithubUrl(data.githubUrl);
          return;
        }
        throw new Error(data.error || 'Save failed');
      }

      const result = await res.json();

      if (initialData.isNew && result.id) {
        window.location.href = `/admin/events/${result.id}`;
        return;
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 8000);
    } catch (err: any) {
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="event-editor-wrapper">
      {dragging && (
        <div class="drop-overlay">
          <div class="drop-overlay-content">Drop image to upload poster</div>
        </div>
      )}
    <fieldset class="event-editor" disabled={readOnly}>
      <section class="editor-section">
        <h2>Event Details</h2>
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

          {showEndDate && (
            <>
              <div class="form-field">
                <label for="event-end-date">End date</label>
                <input id="event-end-date" type="date" value={endDate}
                  onInput={(e) => setEndDate((e.target as HTMLInputElement).value)} />
              </div>
              {showTime && (
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
            <label for="event-body">
              Description (markdown)
              {' · '}
              <a href="https://www.markdownguide.org/basic-syntax/" target="_blank" rel="noopener noreferrer" class="btn-link">
                formatting help
              </a>
            </label>
            <textarea id="event-body" ref={bodyRef} value={body}
              onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)} rows={6} />
          </div>
        </div>
      </section>

      <section class="editor-section">
        <h2>Poster</h2>
        {posterKey && (
          <div class="poster-preview">
            <img src={`${cdnUrl}/cdn-cgi/image/width=400/${posterKey}`} alt="Event poster" />
            <button type="button" class="btn-remove-poster" onClick={() => setPosterKey('')}>Remove</button>
          </div>
        )}
        <button type="button" class="btn-secondary"
          onClick={() => posterInputRef.current?.click()}
          disabled={posterUpload.uploading}>
          {posterUpload.uploading ? 'Uploading...' : posterKey ? 'Replace poster' : 'Upload poster'}
        </button>
        <input ref={posterInputRef} type="file" accept="image/jpeg,image/png,image/webp"
          style="display:none"
          onChange={(e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) uploadPoster(file);
          }} />
      </section>

      <section class="editor-section">
        <h2>Organizer</h2>
        <div class="auth-form">
          <div class="form-field">
            <label>Select organizer</label>
            <div class="organizer-select-row">
              <select value={orgSlug}
                onChange={(e) => selectOrganizer((e.target as HTMLSelectElement).value)}>
                <option value="">-- None --</option>
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
        {saved && (
          <div class="save-success">
            Saved! Your edit will be live in a few minutes.
            {' '}<a href={`/events/${initialData.id}`}>View live</a>
          </div>
        )}
        <button type="button" class="btn-primary" onClick={handleSave} disabled={saving || readOnly}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </fieldset>
    </div>
  );
}
