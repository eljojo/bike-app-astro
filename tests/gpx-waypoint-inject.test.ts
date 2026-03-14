import { describe, it, expect } from 'vitest';
import { injectWaypointsIntoGpx } from '../src/lib/gpx-waypoint-inject';

describe('injectWaypointsIntoGpx', () => {
  it('adds wpt elements before trk', () => {
    const gpx = '<?xml version="1.0"?><gpx><trk><name>Route</name></trk></gpx>';
    const waypoints = [
      { lat: -33.45, lng: -71.22, name: 'PC1: Plaza', type: 'checkpoint', desc: 'Opens 08:34' },
    ];
    const result = injectWaypointsIntoGpx(gpx, waypoints);
    expect(result).toContain('<wpt lat="-33.45" lon="-71.22">');
    expect(result).toContain('<name>PC1: Plaza</name>');
    expect(result).toContain('<type>checkpoint</type>');
    expect(result).toContain('<desc>Opens 08:34</desc>');
    // wpt should appear before trk
    expect(result.indexOf('<wpt')).toBeLessThan(result.indexOf('<trk'));
  });

  it('preserves original GPX content', () => {
    const gpx = '<?xml version="1.0"?><gpx><trk><trkseg><trkpt lat="1" lon="2"/></trkseg></trk></gpx>';
    const result = injectWaypointsIntoGpx(gpx, [{ lat: 0, lng: 0, name: 'Test', type: 'poi' }]);
    expect(result).toContain('<trkpt lat="1" lon="2"/>');
  });

  it('returns original GPX when no waypoints', () => {
    const gpx = '<gpx><trk/></gpx>';
    expect(injectWaypointsIntoGpx(gpx, [])).toBe(gpx);
  });

  it('escapes XML special characters in name and desc', () => {
    const gpx = '<gpx><trk/></gpx>';
    const result = injectWaypointsIntoGpx(gpx, [
      { lat: 0, lng: 0, name: 'A & B <C>', type: 'poi', desc: '"quoted"' },
    ]);
    expect(result).toContain('<name>A &amp; B &lt;C&gt;</name>');
    expect(result).toContain('<desc>&quot;quoted&quot;</desc>');
  });

  it('handles multiple waypoints', () => {
    const gpx = '<gpx><trk/></gpx>';
    const waypoints = [
      { lat: 1, lng: 2, name: 'First', type: 'checkpoint' },
      { lat: 3, lng: 4, name: 'Second', type: 'danger' },
      { lat: 5, lng: 6, name: 'Third', type: 'poi' },
    ];
    const result = injectWaypointsIntoGpx(gpx, waypoints);
    expect(result.match(/<wpt /g)).toHaveLength(3);
  });

  it('inserts before </gpx> when no trk element', () => {
    const gpx = '<gpx></gpx>';
    const result = injectWaypointsIntoGpx(gpx, [
      { lat: 1, lng: 2, name: 'Test', type: 'poi' },
    ]);
    expect(result).toContain('<wpt');
    expect(result.indexOf('<wpt')).toBeLessThan(result.indexOf('</gpx>'));
  });

  it('omits desc element when not provided', () => {
    const gpx = '<gpx><trk/></gpx>';
    const result = injectWaypointsIntoGpx(gpx, [
      { lat: 1, lng: 2, name: 'NoDes', type: 'checkpoint' },
    ]);
    expect(result).not.toContain('<desc>');
  });
});
