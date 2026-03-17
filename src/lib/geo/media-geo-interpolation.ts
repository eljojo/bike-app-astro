interface TrackPoint {
  lat: number;
  lng: number;
  time: number;
}

/**
 * Estimate a media item's GPS coordinates by interpolating its timestamp
 * against the GPX track's time data.
 *
 * @param photoTimeOffset - seconds from track start (same unit as track[i].time)
 * @param track - sorted array of track points with time offsets
 * @returns estimated {lat, lng} or null if track is empty
 */
export function interpolateMediaLocation(
  photoTimeOffset: number,
  track: TrackPoint[],
): { lat: number; lng: number } | null {
  if (track.length === 0) return null;
  if (track.length === 1) return { lat: track[0].lat, lng: track[0].lng };

  // Before first point
  if (photoTimeOffset <= track[0].time) {
    return { lat: track[0].lat, lng: track[0].lng };
  }

  // After last point
  if (photoTimeOffset >= track[track.length - 1].time) {
    const last = track[track.length - 1];
    return { lat: last.lat, lng: last.lng };
  }

  // Binary search for bracketing points
  let lo = 0;
  let hi = track.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track[mid].time <= photoTimeOffset) lo = mid;
    else hi = mid;
  }

  const a = track[lo];
  const b = track[hi];
  const span = b.time - a.time;
  if (span === 0) return { lat: a.lat, lng: a.lng };

  const t = (photoTimeOffset - a.time) / span;
  return {
    lat: a.lat + t * (b.lat - a.lat),
    lng: a.lng + t * (b.lng - a.lng),
  };
}
