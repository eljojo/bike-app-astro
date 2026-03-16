/**
 * Shared helpers for GPX download endpoints.
 * Consolidates response building and file serving.
 */
import fs from 'node:fs';

export { variantSlug, variantFilename } from './filenames';
export { routeGpxPath, rideGpxPath } from './paths.server';

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
