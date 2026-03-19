import { describe, it, expect } from 'vitest';
import {
  isGoogleDirectionsUrl,
  parseGoogleDirectionsUrl,
  normalizeStopName,
} from '../../src/lib/external/google-directions';

const FIXTURE_2_URL =
  'https://www.google.com/maps/dir/The+Royal+Oak+-+Centrepointe,+117+Centrepointe+Dr+Unit+105,+Ottawa,+ON+K2G+5X3,+Canada/45.3268492,-75.8054197/Eaton+St,+Ottawa,+ON,+Canada/Whiprsnapr+Brewing+Co.,+14+Bexley+Pl+%23106,+Nepean,+ON+K2H+8W2,+Canada/@45.3347906,-75.8121228,14z/data=!3m1!4b1!4m21!4m20!1m5!1m1!1s0x4cce073d66aaaaab:0xd95fe42b230f3abd!2m2!1d-75.7625!2d45.3430556!1m0!1m5!1m1!1s0x4cce00a16d004239:0x528e8d2b0373771f!2m2!1d-75.8173974!2d45.3264109!1m5!1m1!1s0x4cce00a2800ba81d:0xdadad1e1f95c4a96!2m2!1d-75.819541!2d45.3301965!3e1?entry=tts&g_ep=EgoyMDI2MDMxNS4wKgBIAVAD&skid=d8bc7d0a-b97c-4020-8fd3-0b0e9e9141d2';

const FIXTURE_3_URL =
  'https://www.google.com/maps/dir/The+Royal+Oak+-+Centrepointe,+117+Centrepointe+Dr+Unit+105,+Ottawa,+ON+K2G+5X3/45.3268492,-75.8054197/Eaton+St,+Ottawa,+ON/Whiprsnapr+Brewing+Co.,+14+Bexley+Pl+%23106,+Nepean,+ON+K2H+8W2/@45.3333972,-75.8101596,13.64z/data=!4m36!4m35!1m20!1m1!1s0x4cce073d66aaaaab:0xd95fe42b230f3abd!2m2!1d-75.7625!2d45.3430556!3m4!1m2!1d-75.776827!2d45.3304549!3s0x4cce07442359adc5:0x2646569dc9f96bb8!3m4!1m2!1d-75.793438!2d45.3270734!3s0x4cce07531dfbb58f:0x4c0020bb1fbb5c0e!3m4!1m2!1d-75.794774!2d45.315746!3s0x4ccdfdf90426b0b7:0x66159e854352c645!1m0!1m5!1m1!1s0x4cce00a16d004239:0x528e8d2b0373771f!2m2!1d-75.8173974!2d45.3264109!1m5!1m1!1s0x4cce00a2800ba81d:0xdadad1e1f95c4a96!2m2!1d-75.819541!2d45.3301965!3e1?entry=ttu&g_ep=EgoyMDI2MDMxNS4wIKXMDSoASAFQAw%3D%3D';

describe('isGoogleDirectionsUrl', () => {
  it('recognizes a Google Directions URL', () => {
    expect(isGoogleDirectionsUrl(FIXTURE_2_URL)).toBe(true);
  });

  it('rejects a Google My Maps URL', () => {
    expect(
      isGoogleDirectionsUrl(
        'https://www.google.com/maps/d/edit?mid=1aBcDeFgHiJkLmNoPqRsT&usp=sharing',
      ),
    ).toBe(false);
  });

  it('rejects a non-Google URL', () => {
    expect(
      isGoogleDirectionsUrl('https://www.openstreetmap.org/#map=12/45.4215/-75.6972'),
    ).toBe(false);
  });

  it('rejects an invalid URL', () => {
    expect(isGoogleDirectionsUrl('not a url')).toBe(false);
  });
});

describe('parseGoogleDirectionsUrl', () => {
  it('parses Fixture 2 — stops, via, coordinates, travel mode', () => {
    const result = parseGoogleDirectionsUrl(FIXTURE_2_URL);
    expect(result).not.toBeNull();
    expect(result!.travelMode).toBe('cycling');
    expect(result!.waypoints).toHaveLength(4);

    // Stop 1: Royal Oak
    expect(result!.waypoints[0]).toEqual({
      lat: 45.3430556,
      lng: -75.7625,
      type: 'stop',
      name: 'The Royal Oak - Centrepointe',
    });

    // Via point: bare coordinates
    expect(result!.waypoints[1]).toEqual({
      lat: 45.3268492,
      lng: -75.8054197,
      type: 'via',
    });

    // Stop 3: Eaton St
    expect(result!.waypoints[2]).toEqual({
      lat: 45.3264109,
      lng: -75.8173974,
      type: 'stop',
      name: 'Eaton St',
    });

    // Stop 4: Whiprsnapr
    expect(result!.waypoints[3]).toEqual({
      lat: 45.3301965,
      lng: -75.819541,
      type: 'stop',
      name: 'Whiprsnapr Brewing Co.',
    });
  });

  it('parses Fixture 3 — shaping points in correct order', () => {
    const result = parseGoogleDirectionsUrl(FIXTURE_3_URL);
    expect(result).not.toBeNull();
    expect(result!.travelMode).toBe('cycling');
    expect(result!.waypoints).toHaveLength(7);

    // Stop 1: Royal Oak
    expect(result!.waypoints[0]).toMatchObject({
      type: 'stop',
      name: 'The Royal Oak - Centrepointe',
      lat: 45.3430556,
      lng: -75.7625,
    });

    // Shaping points (between Royal Oak and the via point)
    expect(result!.waypoints[1]).toEqual({
      lat: 45.3304549,
      lng: -75.776827,
      type: 'shaping',
    });
    expect(result!.waypoints[2]).toEqual({
      lat: 45.3270734,
      lng: -75.793438,
      type: 'shaping',
    });
    expect(result!.waypoints[3]).toEqual({
      lat: 45.315746,
      lng: -75.794774,
      type: 'shaping',
    });

    // Via point
    expect(result!.waypoints[4]).toEqual({
      lat: 45.3268492,
      lng: -75.8054197,
      type: 'via',
    });

    // Eaton St
    expect(result!.waypoints[5]).toMatchObject({
      type: 'stop',
      name: 'Eaton St',
    });

    // Whiprsnapr
    expect(result!.waypoints[6]).toMatchObject({
      type: 'stop',
      name: 'Whiprsnapr Brewing Co.',
    });
  });

  it('returns null for non-directions URLs', () => {
    expect(parseGoogleDirectionsUrl('https://www.google.com/maps/place/Ottawa')).toBeNull();
    expect(
      parseGoogleDirectionsUrl(
        'https://www.google.com/maps/d/edit?mid=1aBcDeFgHiJkLmNoPqRsT',
      ),
    ).toBeNull();
    expect(parseGoogleDirectionsUrl('https://example.com')).toBeNull();
    expect(parseGoogleDirectionsUrl('not a url')).toBeNull();
  });

  it('handles missing data parameter — falls back to path-only', () => {
    const urlNoData =
      'https://www.google.com/maps/dir/Some+Place/45.123,-75.456/Another+Place';
    const result = parseGoogleDirectionsUrl(urlNoData);
    expect(result).not.toBeNull();
    expect(result!.waypoints).toHaveLength(3);

    // Named stop without data param gets NaN coords
    expect(result!.waypoints[0].type).toBe('stop');
    expect(result!.waypoints[0].name).toBe('Some Place');
    expect(Number.isNaN(result!.waypoints[0].lat)).toBe(true);
    expect(Number.isNaN(result!.waypoints[0].lng)).toBe(true);

    // Bare coordinate via keeps its coords
    expect(result!.waypoints[1]).toEqual({
      lat: 45.123,
      lng: -75.456,
      type: 'via',
    });

    // Another named stop
    expect(result!.waypoints[2].type).toBe('stop');
    expect(result!.waypoints[2].name).toBe('Another Place');
    expect(result!.travelMode).toBeNull();
  });
});

describe('normalizeStopName', () => {
  it('takes text before the first comma', () => {
    expect(
      normalizeStopName(
        'The Royal Oak - Centrepointe, 117 Centrepointe Dr Unit 105, Ottawa, ON K2G 5X3, Canada',
      ),
    ).toBe('The Royal Oak - Centrepointe');
  });

  it('returns the full string when there is no comma', () => {
    expect(normalizeStopName('Eaton St')).toBe('Eaton St');
  });

  it('trims whitespace', () => {
    expect(normalizeStopName('  Some Place , extra info ')).toBe('Some Place');
  });
});
