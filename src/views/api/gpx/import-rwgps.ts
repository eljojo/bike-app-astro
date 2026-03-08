const RWGPS_ROUTE_PATTERN = /ridewithgps\.com\/routes\/(\d+)\/?(?:\?privacy_code=([\w\d]+))?/;

/** Extract route ID and optional privacy code from a RideWithGPS URL. Exported for testing. */
export function parseRwgpsUrl(url: string): { routeId: string; privacyCode?: string } | null {
  const match = url.match(RWGPS_ROUTE_PATTERN);
  if (!match) return null;
  return { routeId: match[1], privacyCode: match[2] || undefined };
}

interface RwgpsTrackPoint {
  x: number; // longitude
  y: number; // latitude
  e: number; // elevation (meters)
}

/** Build a GPX XML string from RWGPS API track points. */
export function buildGpxFromTrackPoints(name: string, points: RwgpsTrackPoint[]): string {
  const trkpts = points
    .map((p) => `      <trkpt lat="${p.y}" lon="${p.x}"><ele>${p.e}</ele></trkpt>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="ridewithgps.com">
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
