import { XMLParser } from 'fast-xml-parser';
import polyline from '@mapbox/polyline';

export interface GpxPoint {
  lat: number;
  lon: number;
  ele?: number;
}

export interface GpxTrack {
  points: GpxPoint[];
  distance_m: number;
  elevation_gain_m: number;
  max_gradient_pct: number;
  polyline: string;
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
      });
    }
  }

  if (points.length === 0) return emptyTrack();

  const result: GpxTrack = {
    points,
    distance_m: computeDistance(points),
    elevation_gain_m: computeElevationGain(points),
    max_gradient_pct: computeMaxGradient(points),
    polyline: polyline.encode(points.map(p => [p.lat, p.lon])),
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

function emptyTrack(): GpxTrack {
  return { points: [], distance_m: 0, elevation_gain_m: 0, max_gradient_pct: 0, polyline: '' };
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
