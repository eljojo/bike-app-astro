import { XMLParser } from 'fast-xml-parser';
import polyline from '@mapbox/polyline';

export interface GpxPoint {
  lat: number;
  lon: number;
  ele?: number;
  time?: string;
}

export interface GpxTrack {
  points: GpxPoint[];
  distance_m: number;
  elevation_gain_m: number;
  max_gradient_pct: number;
  polyline: string;
  elapsed_time_s: number;
  moving_time_s: number;
  average_speed_kmh: number;
}

// In-memory cache keyed by string length + first/last 100 chars.
// Avoids re-parsing the same GPX when multiple loaders process the same files.
const gpxCache = new Map<string, GpxTrack>();

function cacheKey(xml: string): string {
  return `${xml.length}:${xml.slice(0, 100)}:${xml.slice(-100)}`;
}

export function parseGpx(xml: string): GpxTrack {
  const key = cacheKey(xml);
  const cached = gpxCache.get(key);
  if (cached) return cached;
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const parsed = parser.parse(xml);

  const trk = parsed?.gpx?.trk;
  if (!trk) return emptyTrack();

  const segments = Array.isArray(trk.trkseg) ? trk.trkseg : [trk.trkseg];
  const points: GpxPoint[] = [];

  for (const seg of segments) {
    if (!seg?.trkpt) continue;
    const pts = Array.isArray(seg.trkpt) ? seg.trkpt : [seg.trkpt];
    for (const pt of pts) {
      points.push({
        lat: parseFloat(pt['@_lat']),
        lon: parseFloat(pt['@_lon']),
        ele: pt.ele != null ? parseFloat(pt.ele) : undefined,
        time: pt.time != null ? String(pt.time) : undefined,
      });
    }
  }

  if (points.length === 0) return emptyTrack();

  const distance_m = computeDistance(points);
  const moving_time_s = computeMovingTime(points);
  const average_speed_kmh = moving_time_s > 0
    ? Math.round((distance_m / 1000) / (moving_time_s / 3600) * 10) / 10
    : 0;

  const result: GpxTrack = {
    points,
    distance_m,
    elevation_gain_m: computeElevationGain(points),
    max_gradient_pct: computeMaxGradient(points),
    polyline: polyline.encode(points.map(p => [p.lat, p.lon])),
    elapsed_time_s: computeElapsedTime(points),
    moving_time_s,
    average_speed_kmh,
  };
  gpxCache.set(key, result);
  return result;
}

/**
 * Extract RideWithGPS URL from GPX metadata, if present.
 * Checks <metadata><link href="..."> for ridewithgps.com URLs.
 */
export function extractRwgpsUrl(xml: string): string | null {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const parsed = parser.parse(xml);

  const metadata = parsed?.gpx?.metadata;
  if (!metadata?.link) return null;

  const links = Array.isArray(metadata.link) ? metadata.link : [metadata.link];
  for (const link of links) {
    const href = link['@_href'] || '';
    if (href.includes('ridewithgps.com/routes/')) {
      return href;
    }
  }

  return null;
}

/**
 * Seconds between first and last trackpoint timestamp.
 * Returns 0 if fewer than 2 points have timestamps.
 */
export function computeElapsedTime(points: GpxPoint[]): number {
  const timestamps = points.filter(p => p.time).map(p => new Date(p.time!).getTime());
  if (timestamps.length < 2) return 0;
  return Math.round((timestamps[timestamps.length - 1] - timestamps[0]) / 1000);
}

/**
 * Sum of time segments where speed exceeds 1 km/h.
 * Uses haversine distance between consecutive points divided by time delta.
 * Returns 0 if fewer than 2 points have timestamps.
 */
export function computeMovingTime(points: GpxPoint[]): number {
  const SPEED_THRESHOLD_MS = 1 / 3.6; // 1 km/h in m/s
  let movingSeconds = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (!prev.time || !curr.time) continue;

    const dt = (new Date(curr.time).getTime() - new Date(prev.time).getTime()) / 1000;
    if (dt <= 0) continue;

    const dist = haversine(prev, curr);
    const speed = dist / dt; // m/s

    if (speed > SPEED_THRESHOLD_MS) {
      movingSeconds += dt;
    }
  }

  return Math.round(movingSeconds);
}

function emptyTrack(): GpxTrack {
  return {
    points: [],
    distance_m: 0,
    elevation_gain_m: 0,
    max_gradient_pct: 0,
    polyline: '',
    elapsed_time_s: 0,
    moving_time_s: 0,
    average_speed_kmh: 0,
  };
}

function computeDistance(points: GpxPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversine(points[i - 1], points[i]);
  }
  return Math.round(total);
}

function computeElevationGain(points: GpxPoint[]): number {
  let gain = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].ele;
    const curr = points[i].ele;
    if (prev != null && curr != null && curr > prev) {
      gain += curr - prev;
    }
  }
  return Math.round(gain);
}

/**
 * Compute the steepest gradient over sliding ~100m windows.
 * Uses absolute elevation change — steep descents are scary too.
 * Smoothing over 100m avoids GPS noise spikes on individual points.
 */
function computeMaxGradient(points: GpxPoint[]): number {
  if (points.length < 2) return 0;

  let maxGrad = 0;
  let windowStart = 0;

  for (let windowEnd = 1; windowEnd < points.length; windowEnd++) {
    let windowDist = 0;
    for (let j = windowStart + 1; j <= windowEnd; j++) {
      windowDist += haversine(points[j - 1], points[j]);
    }

    while (windowStart < windowEnd - 1) {
      const segDist = haversine(points[windowStart], points[windowStart + 1]);
      if (windowDist - segDist < 100) break;
      windowDist -= segDist;
      windowStart++;
    }

    if (windowDist >= 50) {
      const startEle = points[windowStart].ele ?? 0;
      const endEle = points[windowEnd].ele ?? 0;
      const gradient = Math.abs(endEle - startEle) / windowDist * 100;
      if (gradient > maxGrad) maxGrad = gradient;
    }
  }
  return Math.round(maxGrad * 10) / 10;
}

/** Recompute all GpxTrack metrics from a (possibly filtered) set of points. */
export function buildTrackFromPoints(points: GpxPoint[]): GpxTrack {
  if (points.length === 0) return emptyTrack();

  const distance_m = computeDistance(points);
  const moving_time_s = computeMovingTime(points);
  const average_speed_kmh = moving_time_s > 0
    ? Math.round((distance_m / 1000) / (moving_time_s / 3600) * 10) / 10
    : 0;

  return {
    points,
    distance_m,
    elevation_gain_m: computeElevationGain(points),
    max_gradient_pct: computeMaxGradient(points),
    polyline: polyline.encode(points.map(p => [p.lat, p.lon])),
    elapsed_time_s: computeElapsedTime(points),
    moving_time_s,
    average_speed_kmh,
  };
}

export function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLon * sinLon;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Extract ride date (YYYY-MM-DD) from GPX trackpoint time, falling back to metadata time. */
export function extractRideDate(gpxXml: string): string | null {
  // Prefer <time> inside <trkpt> to avoid matching metadata time
  const trkptTimeMatch = gpxXml.match(/<trkpt[^>]*>[^]*?<time>([^<]+)<\/time>/);
  if (trkptTimeMatch) {
    return trkptTimeMatch[1].slice(0, 10);
  }
  // Fall back to first <time> anywhere (some GPX files only have metadata time)
  const fallbackMatch = gpxXml.match(/<time>([^<]+)<\/time>/);
  return fallbackMatch ? fallbackMatch[1].slice(0, 10) : null;
}
