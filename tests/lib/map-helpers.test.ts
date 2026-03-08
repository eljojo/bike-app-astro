import { describe, it, expect } from 'vitest';
import { html, raw, buildPlacePopup } from '../../src/lib/map-helpers';

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
