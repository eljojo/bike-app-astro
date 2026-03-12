import { useState, useEffect } from 'preact/hooks';

interface StravaActivity {
  id: number;
  name: string;
  type: string;
  sport_type: string;
  start_date: string;
  distance: number;
  moving_time: number;
  total_elevation_gain: number;
}

interface ImportResult {
  gpxContent: string;
  name: string;
  strava_id: string;
  start_date: string;
  photos: Array<{ key?: string; caption: string; lat?: number; lng?: number }>;
}

function formatDistance(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function StravaImport() {
  const [open, setOpen] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [activities, setActivities] = useState<StravaActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [imported, setImported] = useState<Set<number>>(new Set());

  useEffect(() => {
    checkStatus();
  }, []);

  async function checkStatus() {
    try {
      const res = await fetch('/api/strava/status');
      if (res.ok) {
        const data = await res.json();
        setConnected(data.connected);
      }
    } catch {
      setConnected(false);
    }
  }

  async function loadActivities(p: number) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/strava/activities?page=${p}&per_page=20`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to load activities');
      }
      const data: StravaActivity[] = await res.json();
      if (p === 1) {
        setActivities(data);
      } else {
        setActivities(prev => [...prev, ...data]);
      }
      setHasMore(data.length === 20);
      setPage(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activities');
    } finally {
      setLoading(false);
    }
  }

  function handleOpen() {
    setOpen(true);
    if (activities.length === 0) loadActivities(1);
  }

  async function handleImport(activity: StravaActivity) {
    setImporting(activity.id);
    setError('');
    try {
      const res = await fetch('/api/strava/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityId: activity.id,
          activityName: activity.name,
          startDate: activity.start_date,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Import failed');
      }
      const result: ImportResult = await res.json();
      setImported(prev => new Set([...prev, activity.id]));

      // Stash full import result (GPX, photos) for the editor to pick up
      sessionStorage.setItem('strava-import', JSON.stringify({
        ...result,
        start_date_local: activity.start_date,
      }));
      const params = new URLSearchParams({
        name: result.name,
        strava_id: result.strava_id,
        date: result.start_date.slice(0, 10),
      });
      window.location.href = `/admin/rides/new?${params}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(null);
    }
  }

  // Don't show anything if not connected
  if (connected === null || connected === false) return null;

  if (!open) {
    return (
      <button type="button" class="btn-primary" onClick={handleOpen}>
        Import from Strava
      </button>
    );
  }

  return (
    <div class="strava-browser">
      <div class="strava-browser--header">
        <strong>Strava Activities</strong>
        <button type="button" class="btn-small" onClick={() => setOpen(false)}>Close</button>
      </div>
      {error && <div class="auth-error">{error}</div>}
      <div class="strava-browser--list">
        {activities.map(a => (
          <div key={a.id} class="strava-activity">
            <div class="strava-activity--info">
              <span class="strava-activity--name">{a.name}</span>
              <span class="strava-activity--meta">
                {formatDate(a.start_date)} · {formatDistance(a.distance)} · {formatDuration(a.moving_time)}
                {a.total_elevation_gain > 0 ? ` · ${Math.round(a.total_elevation_gain)}m` : ''}
              </span>
            </div>
            <button
              type="button"
              class="btn-small"
              onClick={() => handleImport(a)}
              disabled={importing === a.id || imported.has(a.id)}
            >
              {imported.has(a.id) ? 'Imported' : importing === a.id ? 'Importing...' : 'Import'}
            </button>
          </div>
        ))}
      </div>
      {hasMore && (
        <button
          type="button"
          class="btn-small strava-browser--more"
          onClick={() => loadActivities(page + 1)}
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Load more'}
        </button>
      )}
    </div>
  );
}
