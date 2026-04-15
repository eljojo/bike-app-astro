import { describe, it, expect } from 'vitest';
import { html, raw, buildPlacePopup, buildPathPopup, buildWaypointPopup, filterMapByCategory } from '../../src/lib/maps/map-helpers';
import polylineCodec from '@mapbox/polyline';

describe('html tagged template', () => {
  it('escapes interpolated strings', () => {
    const name = '<script>alert(1)</script>';
    expect(html`<strong>${name}</strong>`).toBe(
      '<strong>&lt;script&gt;alert(1)&lt;/script&gt;</strong>'
    );
  });

  it('escapes ampersands and quotes', () => {
    const val = 'A & "B"';
    expect(html`<span title="${val}">${val}</span>`).toBe(
      '<span title="A &amp; &quot;B&quot;">A &amp; &quot;B&quot;</span>'
    );
  });

  it('passes raw values through unescaped', () => {
    const link = raw('<a href="/">Home</a>');
    expect(html`<div>${link}</div>`).toBe('<div><a href="/">Home</a></div>');
  });

  it('handles numbers and nullish values', () => {
    expect(html`<span>${42}</span>`).toBe('<span>42</span>');
    expect(html`<span>${null}</span>`).toBe('<span></span>');
    expect(html`<span>${undefined}</span>`).toBe('<span></span>');
  });
});

describe('buildPlacePopup', () => {
  it('renders name only for minimal place', () => {
    const popup = buildPlacePopup({ name: 'Test Place' });
    expect(popup).toContain('<strong>Test Place</strong>');
    expect(popup).not.toContain('place-popup-photo');
  });

  it('includes photo when cdnUrl provided', () => {
    const popup = buildPlacePopup({ name: 'Cafe', photo_key: 'abc123' }, 'https://cdn.example.com');
    expect(popup).toContain('place-popup-photo');
    expect(popup).toContain('https://cdn.example.com/cdn-cgi/image/width=280%2Cheight=160%2Cfit=cover/abc123');
  });

  it('escapes XSS in place fields', () => {
    const popup = buildPlacePopup({
      name: '<script>alert(1)</script>',
      address: '"><img src=x onerror=alert(1)>',
    });
    expect(popup).not.toContain('<script>');
    expect(popup).not.toContain('<img src=x');
    expect(popup).toContain('&lt;script&gt;');
    expect(popup).toContain('&lt;img');
  });

  it('renders address, phone, and links', () => {
    const popup = buildPlacePopup({
      name: 'Shop',
      address: '123 Main St',
      phone: '613-555-0100',
      link: 'https://shop.ca',
      google_maps_url: 'https://maps.google.com/?q=45,-75',
    });
    expect(popup).toContain('123 Main St');
    expect(popup).toContain('613-555-0100');
    expect(popup).toContain('href="https://shop.ca"');
    expect(popup).toContain('Website');
    expect(popup).toContain('Google Maps');
  });
});

describe('buildWaypointPopup', () => {
  it('renders label and type for minimal waypoint', () => {
    const popup = buildWaypointPopup({ label: 'CP1 Pomaire', type: 'checkpoint' });
    expect(popup).toContain('<strong>CP1 Pomaire</strong>');
    expect(popup).toContain('Checkpoint');
    expect(popup).not.toContain('waypoint-popup-times');
  });

  it('renders distance alongside type', () => {
    const popup = buildWaypointPopup({ label: 'CP1', type: 'checkpoint', distance_km: 85 });
    expect(popup).toContain('Checkpoint');
    expect(popup).toContain('85 km');
  });

  it('renders opening/closing times for checkpoints', () => {
    const popup = buildWaypointPopup({
      label: 'CP1', type: 'checkpoint',
      opening: '08:30', closing: '11:40',
    });
    expect(popup).toContain('08:30');
    expect(popup).toContain('11:40');
    expect(popup).toContain('waypoint-popup-times');
  });

  it('does not render times for non-checkpoint types', () => {
    const popup = buildWaypointPopup({
      label: 'Lookout', type: 'poi',
      opening: '08:30', closing: '11:40',
    });
    expect(popup).not.toContain('waypoint-popup-times');
  });

  it('renders event-specific note', () => {
    const popup = buildWaypointPopup({
      label: 'CP1', type: 'checkpoint',
      note: 'Fill bottles here',
    });
    expect(popup).toContain('Fill bottles here');
    expect(popup).toContain('waypoint-popup-note');
  });

  it('renders place description', () => {
    const popup = buildWaypointPopup({
      label: 'CP1', type: 'checkpoint',
      description: 'Traditional pottery village',
    });
    expect(popup).toContain('Traditional pottery village');
    expect(popup).toContain('waypoint-popup-description');
  });

  it('renders photo when cdnUrl provided', () => {
    const popup = buildWaypointPopup(
      { label: 'CP1', type: 'checkpoint', photo_key: 'abc123' },
      'https://cdn.example.com',
    );
    expect(popup).toContain('waypoint-popup-photo');
    expect(popup).toContain('cdn-cgi/image/width=280%2Cheight=160%2Cfit=cover/abc123');
  });

  it('renders address and links', () => {
    const popup = buildWaypointPopup({
      label: 'CP1', type: 'checkpoint',
      address: '123 Main St',
      website: 'https://cafe.cl',
      google_maps_url: 'https://maps.google.com/?q=x',
    });
    expect(popup).toContain('123 Main St');
    expect(popup).toContain('href="https://cafe.cl"');
    expect(popup).toContain('Google Maps');
  });

  it('escapes XSS in all fields', () => {
    const popup = buildWaypointPopup({
      label: '<script>alert(1)</script>',
      type: 'checkpoint',
      note: '"><img src=x onerror=alert(1)>',
      description: '<b>bold</b>',
      address: '<script>',
    });
    expect(popup).not.toContain('<script>');
    expect(popup).not.toContain('<img src=x');
    expect(popup).not.toContain('<b>bold</b>');
    expect(popup).toContain('&lt;script&gt;');
  });

  it('renders full popup with all fields', () => {
    const popup = buildWaypointPopup({
      label: 'CP1 Pomaire', type: 'checkpoint',
      distance_km: 85, opening: '08:30', closing: '11:40',
      note: 'Opens early on brevet day',
      description: 'Pottery village with good food',
      address: 'Plaza de Armas, Pomaire',
      photo_key: 'abc', website: 'https://pomaire.cl',
      google_maps_url: 'https://maps.google.com/?q=pomaire',
    }, 'https://cdn.example.com');
    expect(popup).toContain('waypoint-popup-photo');
    expect(popup).toContain('CP1 Pomaire');
    expect(popup).toContain('85 km');
    expect(popup).toContain('08:30');
    expect(popup).toContain('Opens early on brevet day');
    expect(popup).toContain('Pottery village with good food');
    expect(popup).toContain('Plaza de Armas, Pomaire');
    expect(popup).toContain('Website');
  });
});

describe('buildPathPopup with segment', () => {
  const baseInput = {
    name: 'Sentier Trans-Canada Gatineau – Montréal',
    url: '/bike-paths/sentier-trans-canada-gatineau-montreal',
    surface: 'asphalt',
    path_type: 'mtb-trail',
  };

  it('Mode A: renders the entry as today when segment is undefined', () => {
    const html = buildPathPopup({ ...baseInput, segment: undefined });
    expect(html).toContain('Sentier Trans-Canada Gatineau');
    expect(html).toContain('asphalt');
    expect(html).not.toContain('Path #15');
  });

  it('Mode A: renders the entry as today when segment name matches entry name', () => {
    const html = buildPathPopup({
      ...baseInput,
      name: 'Aviation Pathway',
      segment: {
        name: 'Aviation Pathway',
        surface_mix: [{ value: 'asphalt', km: 3.2 }],
        lineCount: 15,
      },
    });
    expect(html).toContain('Aviation Pathway');
    const occurrences = (html.match(/Aviation Pathway/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(1);
    expect(occurrences).toBeLessThanOrEqual(2);
  });

  it('Mode A: renders the entry as today when segment name is undefined', () => {
    const html = buildPathPopup({
      ...baseInput,
      segment: {
        name: undefined,
        surface_mix: [{ value: 'asphalt', km: 0.4 }],
        lineCount: 3,
      },
    });
    expect(html).toContain('Sentier Trans-Canada Gatineau');
  });

  it('Mode A: renders the entry as today when segment name is an empty string', () => {
    const html = buildPathPopup({
      ...baseInput,
      segment: {
        name: '',
        surface_mix: [{ value: 'asphalt', km: 0.4 }],
        lineCount: 3,
      },
    });
    // Should fall through to Mode A — no breadcrumb (the only
    // Mode-B-specific class), no segment structure.
    expect(html).toContain('Sentier Trans-Canada Gatineau');
    expect(html).not.toContain('path-popup-parent-link');
  });

  it('Mode A: normalizes punctuation so near-duplicate names fall through', () => {
    // Real-world OSM case: the relation is tagged
    // "Sentier du Parc de la Gatineau" and its member ways are tagged
    // "Sentier du Parc-de-la-Gatineau" (hyphens). The two refer to
    // the same entity — Mode B should NOT fire just because the
    // punctuation differs.
    const html = buildPathPopup({
      name: 'Sentier du Parc de la Gatineau',
      url: '/bike-paths/sentier-du-parc-de-la-gatineau',
      surface: 'asphalt',
      path_type: 'mup',
      segment: {
        name: 'Sentier du Parc-de-la-Gatineau',
        surface_mix: [{ value: 'asphalt', km: 3.2 }],
        lineCount: 10,
      },
    });
    expect(html).toContain('Sentier du Parc de la Gatineau');
    expect(html).not.toContain('path-popup-parent-link');
  });

  it('Mode B: renders segment name and surface_mix when segment name differs from entry name', () => {
    const html = buildPathPopup({
      ...baseInput,
      segment: {
        name: 'Path #15',
        surface_mix: [
          { value: 'asphalt', km: 9.0 },
          { value: 'gravel',  km: 0.1 },
        ],
        lineCount: 12,
      },
    });
    expect(html).toContain('Path #15');
    expect(html).toContain('Sentier Trans-Canada Gatineau');
    expect(html).toContain('asphalt');
    expect(html).toContain('gravel');
    expect(html).toContain('mountain bike trail');
    // Structural ordering: the parent breadcrumb appears ABOVE the
    // segment name in Mode B. A bug that moved the breadcrumb below
    // the segment would still pass the toContain checks above.
    const breadcrumbIdx = html.indexOf('path-popup-parent-link');
    const segmentNameIdx = html.indexOf('Path #15');
    expect(breadcrumbIdx).toBeGreaterThanOrEqual(0);
    expect(segmentNameIdx).toBeGreaterThan(breadcrumbIdx);
    // View details uses the same inline link class as Mode A.
    expect(html).toContain('path-popup-link');
  });
});

// --- filterMapByCategory ---

// East-west track along 45.4215°N in Ottawa (~3 km)
const trackPoints: [number, number][] = [];
for (let i = 0; i <= 30; i++) {
  trackPoints.push([45.4215, -75.7100 + i * 0.001]);
}
const encodedTrack = polylineCodec.encode(trackPoints);

// A second track far away (46°N)
const farTrackPoints: [number, number][] = [];
for (let i = 0; i <= 10; i++) {
  farTrackPoints.push([46.0, -75.7100 + i * 0.001]);
}
const encodedFarTrack = polylineCodec.encode(farTrackPoints);

const places = [
  { category: 'cafe', lat: 45.4220, lng: -75.7000, name: 'Cafe A' },   // ~56m from track
  { category: 'cafe', lat: 45.4215, lng: -75.6900, name: 'Cafe B' },   // on track
  { category: 'beach', lat: 45.4230, lng: -75.6950, name: 'Beach X' }, // ~167m from track
  { category: 'beach', lat: 46.5, lng: -75.7, name: 'Beach Far' },     // far from both tracks
];

const routes = [
  { polyline: encodedTrack, name: 'Near route' },
  { polyline: encodedFarTrack, name: 'Far route' },
];

describe('filterMapByCategory', () => {
  it('filters places to only the matching category', () => {
    const result = filterMapByCategory(places, routes, 'cafe');
    expect(result.places).toHaveLength(2);
    expect(result.places.every(p => p.category === 'cafe')).toBe(true);
  });

  it('keeps routes that pass near a matching place', () => {
    const result = filterMapByCategory(places, routes, 'cafe');
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0].name).toBe('Near route');
  });

  it('excludes routes far from any matching place', () => {
    const result = filterMapByCategory(places, routes, 'cafe');
    expect(result.routes.find(r => r.name === 'Far route')).toBeUndefined();
  });

  it('works for a different category', () => {
    const result = filterMapByCategory(places, routes, 'beach');
    expect(result.places).toHaveLength(2);
    // Beach X is near the track, Beach Far is not near either
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0].name).toBe('Near route');
  });

  it('returns empty when no places match the category', () => {
    const result = filterMapByCategory(places, routes, 'ice-cream');
    expect(result.places).toHaveLength(0);
    expect(result.routes).toHaveLength(0);
  });

  it('preserves extra properties on places and routes', () => {
    const result = filterMapByCategory(places, routes, 'cafe');
    expect(result.places[0].name).toBe('Cafe A');
    expect(result.routes[0].name).toBe('Near route');
  });
});
