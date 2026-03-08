import { describe, it, expect } from 'vitest';
import { parseGoogleMapsUrl, extractKmlRoute } from '../src/lib/google-maps';

describe('parseGoogleMapsUrl', () => {
  it('extracts mid from standard edit URL', () => {
    const url = 'https://www.google.com/maps/d/edit?mid=1aBcDeFgHiJkLmNoPqRsT&usp=sharing';
    expect(parseGoogleMapsUrl(url)).toEqual({ mid: '1aBcDeFgHiJkLmNoPqRsT' });
  });

  it('extracts mid from viewer URL', () => {
    const url = 'https://www.google.com/maps/d/viewer?mid=1xYzAbCdEfGhIjKlMnOp&ll=45.4215,-75.6972&z=12';
    expect(parseGoogleMapsUrl(url)).toEqual({ mid: '1xYzAbCdEfGhIjKlMnOp' });
  });

  it('extracts mid from embed URL', () => {
    const url = 'https://www.google.com/maps/d/embed?mid=1TestMapIdentifier123&ehbc=2E312F';
    expect(parseGoogleMapsUrl(url)).toEqual({ mid: '1TestMapIdentifier123' });
  });

  it('returns null for non-My Maps Google URL', () => {
    const url = 'https://www.google.com/maps/place/Ottawa,+ON/@45.4215,-75.6972,12z';
    expect(parseGoogleMapsUrl(url)).toBeNull();
  });

  it('returns null for non-Google URL', () => {
    const url = 'https://www.openstreetmap.org/#map=12/45.4215/-75.6972';
    expect(parseGoogleMapsUrl(url)).toBeNull();
  });

  it('returns null when mid parameter is missing', () => {
    const url = 'https://www.google.com/maps/d/edit?usp=sharing';
    expect(parseGoogleMapsUrl(url)).toBeNull();
  });

  it('handles URL without www prefix', () => {
    const url = 'https://google.com/maps/d/edit?mid=1NoWwwPrefix';
    expect(parseGoogleMapsUrl(url)).toEqual({ mid: '1NoWwwPrefix' });
  });

  it('returns null for empty or invalid URL', () => {
    expect(parseGoogleMapsUrl('')).toBeNull();
    expect(parseGoogleMapsUrl('not a url')).toBeNull();
  });
});

describe('extractKmlRoute', () => {
  const SAMPLE_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Ottawa Canal Route</name>
    <Folder>
      <name>Cycling Layer</name>
      <Placemark>
        <name>Start Point</name>
        <Point>
          <coordinates>-75.6972,45.4215,70</coordinates>
        </Point>
      </Placemark>
      <Placemark>
        <name>Canal Path</name>
        <LineString>
          <coordinates>-75.6972,45.4215,70 -75.6872,45.4315,80 -75.6772,45.4415,75</coordinates>
        </LineString>
      </Placemark>
    </Folder>
  </Document>
</kml>`;

  it('extracts name and coordinates from KML with LineString', () => {
    const result = extractKmlRoute(SAMPLE_KML);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('Ottawa Canal Route');
    expect(result!.points).toHaveLength(3);
    expect(result!.points[0]).toEqual({ lon: -75.6972, lat: 45.4215, ele: 70 });
    expect(result!.points[1]).toEqual({ lon: -75.6872, lat: 45.4315, ele: 80 });
    expect(result!.points[2]).toEqual({ lon: -75.6772, lat: 45.4415, ele: 75 });
  });

  it('uses folder name when document name is generic', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Untitled map</name>
    <Folder>
      <name>River Path</name>
      <Placemark>
        <LineString>
          <coordinates>-75.6972,45.4215,70 -75.6872,45.4315,80</coordinates>
        </LineString>
      </Placemark>
    </Folder>
  </Document>
</kml>`;
    const result = extractKmlRoute(kml);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('River Path');
  });

  it('handles coordinates without elevation', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Flat Route</name>
    <Folder>
      <name>Layer 1</name>
      <Placemark>
        <LineString>
          <coordinates>-75.6972,45.4215 -75.6872,45.4315</coordinates>
        </LineString>
      </Placemark>
    </Folder>
  </Document>
</kml>`;
    const result = extractKmlRoute(kml);
    expect(result).not.toBeNull();
    expect(result!.points).toHaveLength(2);
    expect(result!.points[0].ele).toBeUndefined();
    expect(result!.points[0].lat).toBeCloseTo(45.4215);
    expect(result!.points[0].lon).toBeCloseTo(-75.6972);
  });

  it('returns null when no LineString is present', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Markers Only</name>
    <Folder>
      <name>Points</name>
      <Placemark>
        <Point>
          <coordinates>-75.6972,45.4215,70</coordinates>
        </Point>
      </Placemark>
    </Folder>
  </Document>
</kml>`;
    expect(extractKmlRoute(kml)).toBeNull();
  });

  it('takes the first LineString when multiple exist', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Multi Route</name>
    <Folder>
      <name>Routes</name>
      <Placemark>
        <LineString>
          <coordinates>-75.70,45.42,70 -75.69,45.43,80</coordinates>
        </LineString>
      </Placemark>
      <Placemark>
        <LineString>
          <coordinates>-75.60,45.50,90 -75.59,45.51,100</coordinates>
        </LineString>
      </Placemark>
    </Folder>
  </Document>
</kml>`;
    const result = extractKmlRoute(kml);
    expect(result).not.toBeNull();
    expect(result!.points).toHaveLength(2);
    expect(result!.points[0].lon).toBeCloseTo(-75.70);
    expect(result!.points[0].lat).toBeCloseTo(45.42);
  });

  it('skips Point placemarks and only extracts LineString', () => {
    const result = extractKmlRoute(SAMPLE_KML);
    // The sample has 3 coordinate pairs in the LineString, not the Point
    expect(result!.points).toHaveLength(3);
  });

  it('handles KML with LineStrings across multiple folders', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Complex Map</name>
    <Folder>
      <name>Markers</name>
      <Placemark>
        <Point><coordinates>-75.70,45.42</coordinates></Point>
      </Placemark>
    </Folder>
    <Folder>
      <name>Routes</name>
      <Placemark>
        <LineString>
          <coordinates>-75.68,45.43,65 -75.67,45.44,70</coordinates>
        </LineString>
      </Placemark>
    </Folder>
  </Document>
</kml>`;
    const result = extractKmlRoute(kml);
    expect(result).not.toBeNull();
    expect(result!.points).toHaveLength(2);
    expect(result!.points[0].lon).toBeCloseTo(-75.68);
  });
});
