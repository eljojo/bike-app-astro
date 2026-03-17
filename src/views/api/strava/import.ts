import type { APIContext } from 'astro';
import { authorize } from '@/lib/auth/authorize';
import { jsonResponse, jsonError } from '@/lib/api-response';
import {
  fetchActivityStreams,
  fetchActivityPhotos,
  buildGpxFromStravaStreams,
  type StravaPhoto,
} from '@/lib/external/strava-api';
import { interpolateMediaLocation } from '@/lib/geo/media-geo-interpolation';
import { createStravaTokenProvider } from '@/lib/external/strava-token-provider';
import { db } from '@/lib/get-db';
import { env } from '@/lib/env/env.service';
import { checkRateLimit, recordAttempt, cleanupOldAttempts } from '@/lib/auth/rate-limit';

export const prerender = false;

function photoTimeOffset(photo: StravaPhoto, activityStartTime: Date): number | null {
  if (!photo.created_at) return null;
  const photoTime = new Date(photo.created_at).getTime();
  const startMs = activityStartTime.getTime();
  return (photoTime - startMs) / 1000; // seconds from activity start
}

export async function POST({ request, locals }: APIContext) {
  const user = authorize(locals, 'import-gpx');
  if (user instanceof Response) return user;

  const database = db();

  // Rate limit: 10 imports per hour
  const exceeded = await checkRateLimit(database, 'strava-import', [user.id.toString()], 10);
  if (exceeded) return jsonError('Too many imports. Try again later.', 429);
  await recordAttempt(database, 'strava-import', [user.id.toString()]);
  cleanupOldAttempts(database, 'strava-import').catch(() => {});

  const { activityId, activityName, startDate } = await request.json();
  if (!activityId) return jsonError('Missing activityId', 400);

  const tokenProvider = await createStravaTokenProvider(database, env, user.id);
  if (!tokenProvider) return jsonError('Strava not connected', 401);

  try {
    // Fetch streams and photos in parallel
    const [streams, photos] = await Promise.all([
      fetchActivityStreams(tokenProvider, String(activityId)),
      fetchActivityPhotos(tokenProvider, String(activityId)),
    ]);

    if (!streams.latlng?.data?.length) {
      return jsonError('Activity has no GPS data', 400);
    }

    const startTime = new Date(startDate);
    const gpxContent = buildGpxFromStravaStreams(activityName || 'Strava Ride', streams, startTime);

    // Build track for photo interpolation
    const track = streams.latlng.data.map((ll, i) => ({
      lat: ll[0],
      lng: ll[1],
      time: streams.time?.data?.[i] ?? 0,
    }));

    // Estimate photo GPS from timestamps and download to R2
    const photoEntries = await Promise.all(
      photos
        .filter((p) => p.urls && Object.keys(p.urls).length > 0)
        .map(async (photo) => {
          const maxSize = Object.keys(photo.urls).map(Number).filter(Boolean).sort((a, b) => b - a)[0];
          const photoUrl = photo.urls[String(maxSize)] || Object.values(photo.urls)[0];

          const timeOffset = photoTimeOffset(photo, startTime);
          const location = timeOffset != null ? interpolateMediaLocation(timeOffset, track) : null;

          // Download photo and upload to R2
          let key: string | undefined;
          if (photoUrl) {
            try {
              const photoResponse = await fetch(photoUrl);
              if (photoResponse.ok) {
                const buffer = await photoResponse.arrayBuffer();
                key = `${env.STORAGE_KEY_PREFIX}strava-${photo.unique_id}`;
                await env.BUCKET.put(key, buffer);
              }
            } catch {
              // Photo download failed — continue without it
            }
          }

          return {
            strava_id: photo.unique_id,
            key,
            caption: photo.caption || '',
            lat: location?.lat,
            lng: location?.lng,
            created_at: photo.created_at,
          };
        }),
    );

    return jsonResponse({
      gpxContent,
      name: activityName,
      strava_id: String(activityId),
      start_date: startDate,
      photos: photoEntries.filter((p) => p.key),
    });
  } catch (err) {
    console.error('Strava import error:', err);
    return jsonError('Failed to import from Strava', 502);
  }
}
