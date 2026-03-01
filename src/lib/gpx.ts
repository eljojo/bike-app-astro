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
  polyline: string;
}

export function parseGpx(xml: string): GpxTrack {
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

  return {
    points,
    distance_m: computeDistance(points),
    elevation_gain_m: computeElevationGain(points),
    polyline: polyline.encode(points.map(p => [p.lat, p.lon])),
  };
}

function emptyTrack(): GpxTrack {
  return { points: [], distance_m: 0, elevation_gain_m: 0, polyline: '' };
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

function haversine(a: GpxPoint, b: GpxPoint): number {
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
