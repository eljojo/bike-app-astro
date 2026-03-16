// AGENTS.md: See src/components/admin/AGENTS.md for editor rules.
// Shared Strava activity browser used by RideEditor (inline) and StravaImport (standalone).
import { useState, useEffect } from 'preact/hooks';
import { formatDurationLoose } from '../../lib/date-utils';

export interface StravaActivity {
  id: number;
  name: string;
  sport_type: string;
  distance: number;
  elapsed_time: number;
  moving_time: number;
  total_elevation_gain: number;
  start_date: string;
  start_date_local: string;
  map: { summary_polyline: string };
  photo_count: number;
}

export interface StravaImportResult {
  name: string;
  strava_id: string;
  start_date: string;
  start_date_local: string;
  gpxContent: string;
  photos: Array<{ key: string; caption: string; lat?: number; lng?: number }>;
}

interface Props {
  onImport: (result: StravaImportResult) => void;
  onClose: () => void;
}

function formatDistance(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}


function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

export default function StravaActivityBrowser({ onImport, onClose }: Props) {
  const [activities, setActivities] = useState<StravaActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);

  async function loadActivities(p: number) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/strava/activities?page=${p}&per_page=20`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to load activities (${res.status})`);
      }
      const data: StravaActivity[] = await res.json();
      setActivities(data);
      setPage(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activities');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadActivities(1); }, []);

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
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Import failed (${res.status})`);
      }
      const result = await res.json();
      onImport({
        ...result,
        start_date: activity.start_date,
        start_date_local: activity.start_date_local,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(null);
    }
  }

  return (
    <div class="strava-browser-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="strava-browser">
        <div class="strava-browser-header">
          <h3>Import from Strava</h3>
          <button type="button" class="btn-small" onClick={onClose}>Close</button>
        </div>
        {error && <div class="auth-error">{error}</div>}
        {loading ? (
          <div class="strava-browser-loading">Loading activities...</div>
        ) : (
          <div class="strava-activity-list">
            {activities.map((activity) => (
              <button
                key={activity.id}
                type="button"
                class="strava-activity-card"
                onClick={() => handleImport(activity)}
                disabled={importing !== null}
              >
                <div class="strava-activity-card-main">
                  <span class="strava-activity-name">{activity.name}</span>
                  <span class="strava-activity-date">{formatDate(activity.start_date_local)}</span>
                </div>
                <div class="strava-activity-card-meta">
                  <span>{formatDistance(activity.distance)}</span>
                  <span>{formatDurationLoose(activity.elapsed_time)}</span>
                  <span class="strava-activity-type">{activity.sport_type}</span>
                  {activity.photo_count > 0 && <span>{activity.photo_count} photos</span>}
                </div>
              </button>
            ))}
            {activities.length === 0 && !loading && (
              <div class="strava-browser-empty">No cycling activities found.</div>
            )}
          </div>
        )}
        {importing !== null && <div class="strava-browser-loading">Importing activity...</div>}
        <div class="strava-browser-pagination">
          {page > 1 && (
            <button type="button" class="btn-small" onClick={() => loadActivities(page - 1)} disabled={loading}>
              Previous
            </button>
          )}
          {activities.length === 20 && (
            <button type="button" class="btn-small" onClick={() => loadActivities(page + 1)} disabled={loading}>
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
