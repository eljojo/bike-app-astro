/**
 * Shared helpers for GPX download endpoints.
 * Consolidates variant name parsing, file path construction, and response building.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Extract URL-friendly slug from variant gpx field: "variants/return.gpx" → "return", "track.gpx" → "track" */
export function variantSlug(gpxField: string): string {
  return gpxField.replace(/\.gpx$/, '').replace(/^variants\//, '');
}

/** Strip directory prefix from variant gpx field: "variants/return.gpx" → "return.gpx", "track.gpx" → "track.gpx" */
export function variantFilename(gpxField: string): string {
  return gpxField.replace(/^variants\//, '');
}

/** Resolve the absolute path to a route variant's GPX file. */
export function routeGpxPath(cityDir: string, routeSlug: string, variantGpx: string): string {
  return path.join(cityDir, 'routes', routeSlug, variantGpx);
}

/** Resolve the absolute path to a ride's GPX file. */
export function rideGpxPath(cityDir: string, gpxRelativePath: string): string {
  return path.join(cityDir, 'rides', gpxRelativePath);
}

/** Build a GPX download Response with appropriate headers. */
export function gpxResponse(content: string, filename: string): Response {
  return new Response(content, {
    headers: {
      'Content-Type': 'application/gpx+xml',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

/** Read a GPX file and return a download Response. Returns null if file doesn't exist. */
export function serveGpxFile(filePath: string, filename: string): Response | null {
  if (!fs.existsSync(filePath)) return null;
  return gpxResponse(fs.readFileSync(filePath, 'utf-8'), filename);
}
