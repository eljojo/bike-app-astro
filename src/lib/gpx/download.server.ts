/**
 * Shared helpers for GPX download endpoints.
 * Consolidates response building and variant naming.
 */

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
