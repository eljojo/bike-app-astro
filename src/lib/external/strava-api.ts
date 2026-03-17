// Vendor isolation wrapper for all Strava API interactions.
// See: src/lib/AGENTS.md — vendor isolation rule.

const STRAVA_API_BASE = 'https://www.strava.com/api/v3';
const STRAVA_OAUTH_URL = 'https://www.strava.com/oauth/token';
const STRAVA_ACTIVITY_PATTERN = /strava\.com\/activities\/(\d+)\/?$/;

const RIDE_SPORT_TYPES = ['Ride', 'EBikeRide', 'VirtualRide', 'GravelRide'];

export function parseStravaActivityUrl(url: string): { activityId: string } | null {
  const match = url.match(STRAVA_ACTIVITY_PATTERN);
  return match ? { activityId: match[1] } : null;
}

export { RIDE_SPORT_TYPES };

// --- OAuth ---

export function buildAuthorizationUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'activity:read',
    approval_prompt: 'auto',
    state,
  });
  return `https://www.strava.com/oauth/authorize?${params}`;
}

export async function exchangeToken(
  clientId: string,
  clientSecret: string,
  code: string,
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete: { id: number; firstname: string; lastname: string };
}> {
  const response = await fetch(STRAVA_OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Strava token exchange failed (${response.status}): ${text}`);
  }
  return response.json();
}

export async function refreshToken(
  clientId: string,
  clientSecret: string,
  refreshTokenValue: string,
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_at: number;
}> {
  const response = await fetch(STRAVA_OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshTokenValue,
      grant_type: 'refresh_token',
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Strava token refresh failed (${response.status}): ${text}`);
  }
  return response.json();
}

// --- API Calls ---

export interface StravaTokenProvider {
  getAccessToken(): Promise<string>;
}

async function stravaFetch(tokenProvider: StravaTokenProvider, path: string, params?: Record<string, string>): Promise<Response> {
  const accessToken = await tokenProvider.getAccessToken();
  const url = new URL(`${STRAVA_API_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  return fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export interface StravaActivity {
  id: number;
  name: string;
  sport_type: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  start_date: string;
  start_date_local: string;
  map: { summary_polyline: string };
  photo_count: number;
  visibility: string;
}

export interface StravaStreams {
  latlng?: { data: [number, number][] };
  altitude?: { data: number[] };
  time?: { data: number[] };
}

export interface StravaPhoto {
  unique_id: string;
  urls: Record<string, string>;
  caption: string;
  created_at: string;
  created_at_local: string;
}

export async function fetchActivities(
  tokenProvider: StravaTokenProvider,
  page = 1,
  perPage = 30,
): Promise<StravaActivity[]> {
  const response = await stravaFetch(tokenProvider, '/athlete/activities', {
    page: String(page),
    per_page: String(perPage),
  });
  if (!response.ok) throw new Error(`Strava activities fetch failed: ${response.status}`);
  const activities: StravaActivity[] = await response.json();
  return activities.filter((a) => RIDE_SPORT_TYPES.includes(a.sport_type));
}

export async function fetchActivityStreams(
  tokenProvider: StravaTokenProvider,
  activityId: string,
): Promise<StravaStreams> {
  const response = await stravaFetch(
    tokenProvider,
    `/activities/${activityId}/streams`,
    { keys: 'latlng,altitude,time', key_type: 'stream' },
  );
  if (!response.ok) throw new Error(`Strava streams fetch failed: ${response.status}`);
  // Strava returns array of stream objects, convert to keyed format
  const streams: Array<{ type: string; data: unknown[] }> = await response.json();
  const result: StravaStreams = {};
  for (const s of streams) {
    if (s.type === 'latlng') result.latlng = { data: s.data as [number, number][] };
    if (s.type === 'altitude') result.altitude = { data: s.data as number[] };
    if (s.type === 'time') result.time = { data: s.data as number[] };
  }
  return result;
}

export async function fetchActivityPhotos(
  tokenProvider: StravaTokenProvider,
  activityId: string,
): Promise<StravaPhoto[]> {
  const response = await stravaFetch(
    tokenProvider,
    `/activities/${activityId}/photos`,
    { photo_sources: 'true', size: '3000' },
  );
  if (!response.ok) throw new Error(`Strava photos fetch failed: ${response.status}`);
  return response.json();
}

// --- GPX Building ---

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Build a GPX XML string from Strava activity streams.
 * Time for each point = startTime + stream.time[i] seconds.
 */
export function buildGpxFromStravaStreams(
  name: string,
  streams: StravaStreams,
  startTime: Date,
): string {
  const latlng = streams.latlng?.data ?? [];
  const altitude = streams.altitude?.data;
  const time = streams.time?.data;

  const trkpts = latlng.map((ll, i) => {
    const parts = [`      <trkpt lat="${ll[0]}" lon="${ll[1]}">`];
    if (altitude?.[i] != null) parts.push(`        <ele>${altitude[i]}</ele>`);
    if (time?.[i] != null) {
      const t = new Date(startTime.getTime() + time[i] * 1000);
      parts.push(`        <time>${t.toISOString()}</time>`);
    }
    parts.push('      </trkpt>');
    return parts.join('\n');
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="strava.com">
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}
