import { describe, it, expect } from 'vitest';
import { html, raw, buildPlacePopup, buildWaypointPopup } from '../../src/lib/map-helpers';

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
    expect(popup).toContain('https://cdn.example.com/cdn-cgi/image/width=280,height=160,fit=cover/abc123');
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
    expect(popup).toContain('cdn-cgi/image/width=280,height=160,fit=cover/abc123');
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
