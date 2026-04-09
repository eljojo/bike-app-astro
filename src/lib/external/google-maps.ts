import { XMLParser } from 'fast-xml-parser';

export interface KmlPoint {
  lon: number;
  lat: number;
  ele?: number;
}

export interface KmlRoute {
  name: string;
  points: KmlPoint[];
}

/**
 * Extract the `mid` parameter from a Google My Maps URL.
 * Supports edit, viewer, and embed URL formats.
 * Returns null for non-My Maps URLs or if mid is missing.
 */
export function parseGoogleMapsUrl(url: string): { mid: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  // Must be a google.com domain
  if (parsed.hostname !== 'google.com' && !parsed.hostname.endsWith('.google.com')) return null;

  // Must match /maps/d/(edit|viewer|embed) path pattern
  const myMapsPattern = /^\/maps\/d\/(edit|viewer|embed)\/?$/;
  if (!myMapsPattern.test(parsed.pathname)) return null;

  const mid = parsed.searchParams.get('mid');
  if (!mid) return null;

  return { mid };
}

/** Names considered generic — fall back to folder name when these appear. */
const GENERIC_DOC_NAMES = new Set(['untitled map', 'untitled']);

/**
 * Parse KML XML and extract the first LineString route.
 * Returns the route name and array of coordinate points, or null if no LineString is found.
 *
 * Uses `removeNSPrefix: true` to strip KML namespace prefixes.
 */
export function extractKmlRoute(kml: string): KmlRoute | null {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
  });
  const parsed = parser.parse(kml);

  const doc = parsed?.kml?.Document;
  if (!doc) return null;

  const docName = typeof doc.name === 'string' ? doc.name : '';

  // Collect all folders — normalize to array
  const folders = toArray(doc.Folder);

  // Find the first LineString across all placemarks in all folders
  let firstLineString: string | null = null;
  let folderName = '';

  for (const folder of folders) {
    if (!folder) continue;
    if (!folderName && typeof folder.name === 'string') {
      folderName = folder.name;
    }

    const placemarks = toArray(folder.Placemark);
    for (const pm of placemarks) {
      if (!pm?.LineString?.coordinates) continue;
      if (!firstLineString) {
        firstLineString = pm.LineString.coordinates;
        // Capture the folder name containing the first LineString
        if (typeof folder.name === 'string') {
          folderName = folder.name;
        }
        break;
      }
    }
    if (firstLineString) break;
  }

  // Also check top-level placemarks (not inside folders)
  if (!firstLineString) {
    const topPlacemarks = toArray(doc.Placemark);
    for (const pm of topPlacemarks) {
      if (!pm?.LineString?.coordinates) continue;
      firstLineString = pm.LineString.coordinates;
      break;
    }
  }

  if (!firstLineString) return null;

  // Determine the best name: use doc name unless it's generic
  const isGenericName = GENERIC_DOC_NAMES.has(docName.toLowerCase().trim());
  const name = isGenericName && folderName ? folderName : docName || folderName || 'Untitled';

  // Parse coordinate string: "lon,lat,ele lon,lat,ele ..."
  const points = parseCoordinates(firstLineString);

  return { name, points };
}

/**
 * Parse KML coordinate string into an array of KmlPoint.
 * Format: "lon,lat[,ele] lon,lat[,ele] ..."
 * Coordinates are space-separated (or newline-separated), components are comma-separated.
 */
function parseCoordinates(coordString: string): KmlPoint[] {
  const points: KmlPoint[] = [];
  const tuples = coordString.trim().split(/\s+/);

  for (const tuple of tuples) {
    const parts = tuple.split(',');
    if (parts.length < 2) continue;

    const lon = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);

    if (isNaN(lon) || isNaN(lat)) continue;

    const point: KmlPoint = { lon, lat };
    if (parts.length >= 3) {
      const ele = parseFloat(parts[2]);
      if (!isNaN(ele)) {
        point.ele = ele;
      }
    }

    points.push(point);
  }

  return points;
}

/** Normalize a value to an array — handles undefined, single item, or array. */
function toArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}
