import { useState, useEffect, useRef } from 'preact/hooks';

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

export default function EventEditor({ initialData, organizers, cdnUrl }: Props) {
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
  const [body, setBody] = useState(initialData.body);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Organizer state
  const initOrg = resolveOrganizer(initialData.organizer, organizers);
  const [orgSlug, setOrgSlug] = useState(initOrg.slug);
  const [orgName, setOrgName] = useState(initOrg.name);
  const [orgWebsite, setOrgWebsite] = useState(initOrg.website);
  const [orgInstagram, setOrgInstagram] = useState(initOrg.instagram);
  const [showOrgForm, setShowOrgForm] = useState(initOrg.name !== '');

  // Poster upload
  const [uploadingPoster, setUploadingPoster] = useState(false);
  const posterInputRef = useRef<HTMLInputElement>(null);

  // Save state
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [githubUrl, setGithubUrl] = useState('');

  // Preact hydration bug workaround (same as RouteEditor)
  useEffect(() => {
    if (bodyRef.current && body && !bodyRef.current.value) {
      bodyRef.current.value = body;
    }
  }, []);

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
    setUploadingPoster(true);

    try {
      const presignRes = await fetch('/api/media/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: file.type }),
      });
      if (!presignRes.ok) throw new Error('Failed to get upload URL');
      const { key, uploadUrl } = await presignRes.json();

      await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });

      const confirmRes = await fetch('/api/media/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (!confirmRes.ok) throw new Error('Upload confirmation failed');

      setPosterKey(key);
    } catch (err: any) {
      setError(err.message || 'Poster upload failed');
    } finally {
      setUploadingPoster(false);
    }
  }

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
          ...(posterKey && { poster_key: posterKey, poster_content_type: 'image/jpeg' }),
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
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="event-editor">
      <section class="editor-section">
        <h2>Event Details</h2>
        <div class="auth-form">
          <div class="form-field">
            <label for="event-name">Name</label>
            <input id="event-name" type="text" value={name}
              onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          </div>

          <div class="form-row">
            <div class="form-field">
              <label for="event-start-date">Start Date</label>
              <input id="event-start-date" type="date" value={startDate}
                onInput={(e) => setStartDate((e.target as HTMLInputElement).value)} />
            </div>
            <div class="form-field">
              <label for="event-start-time">Start Time</label>
              <input id="event-start-time" type="time" value={startTime}
                onInput={(e) => setStartTime((e.target as HTMLInputElement).value)} />
            </div>
          </div>

          <div class="form-row">
            <div class="form-field">
              <label for="event-end-date">End Date</label>
              <input id="event-end-date" type="date" value={endDate}
                onInput={(e) => setEndDate((e.target as HTMLInputElement).value)} />
            </div>
            <div class="form-field">
              <label for="event-end-time">End Time</label>
              <input id="event-end-time" type="time" value={endTime}
                onInput={(e) => setEndTime((e.target as HTMLInputElement).value)} />
            </div>
          </div>

          <div class="form-field">
            <label for="event-location">Location</label>
            <input id="event-location" type="text" value={location}
              onInput={(e) => setLocation((e.target as HTMLInputElement).value)} />
          </div>

          <div class="form-field">
            <label for="event-distances">Distances</label>
            <input id="event-distances" type="text" value={distances}
              placeholder="e.g. 10km loop, 25km and 50km options"
              onInput={(e) => setDistances((e.target as HTMLInputElement).value)} />
          </div>

          <div class="form-field">
            <label for="event-registration">Registration URL</label>
            <input id="event-registration" type="url" value={registrationUrl}
              onInput={(e) => setRegistrationUrl((e.target as HTMLInputElement).value)} />
          </div>

          <div class="form-field">
            <label for="event-review">Review URL</label>
            <input id="event-review" type="url" value={reviewUrl}
              onInput={(e) => setReviewUrl((e.target as HTMLInputElement).value)} />
          </div>

          <div class="form-field">
            <label for="event-body">Description (markdown)</label>
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
          disabled={uploadingPoster}>
          {uploadingPoster ? 'Uploading...' : posterKey ? 'Replace poster' : 'Upload poster'}
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
        {saved && <div class="save-success">Saved! Site rebuild triggered.</div>}
        <button type="button" class="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}
