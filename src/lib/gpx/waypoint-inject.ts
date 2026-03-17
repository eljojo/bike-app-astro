export interface GpxWaypoint {
  lat: number;
  lng: number;
  name: string;
  type: string;
  desc?: string;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Inject waypoint (wpt) elements into GPX XML before the first <trk> element.
 * Returns the original string if no waypoints to inject.
 */
export function injectWaypointsIntoGpx(gpxXml: string, waypoints: GpxWaypoint[]): string {
  if (waypoints.length === 0) return gpxXml;

  const wptElements = waypoints.map(wp => {
    const desc = wp.desc ? `\n    <desc>${escapeXml(wp.desc)}</desc>` : '';
    return `  <wpt lat="${wp.lat}" lon="${wp.lng}">
    <name>${escapeXml(wp.name)}</name>
    <type>${escapeXml(wp.type)}</type>${desc}
  </wpt>`;
  }).join('\n');

  // Insert before <trk
  const trkIndex = gpxXml.indexOf('<trk');
  if (trkIndex === -1) {
    // No trk element — insert before closing </gpx>
    const gpxClose = gpxXml.lastIndexOf('</gpx>');
    if (gpxClose === -1) return gpxXml;
    return gpxXml.slice(0, gpxClose) + wptElements + '\n' + gpxXml.slice(gpxClose);
  }

  return gpxXml.slice(0, trkIndex) + wptElements + '\n' + gpxXml.slice(trkIndex);
}
