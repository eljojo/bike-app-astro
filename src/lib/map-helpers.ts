interface PlacePopupData {
  name: string;
  description?: string;
  link?: string;
  google_maps_url?: string;
  address?: string;
  phone?: string;
  photo_key?: string;
  category?: string;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Marker type for pre-escaped HTML that should not be double-escaped. */
const RAW = Symbol('raw');

interface RawHtml {
  [RAW]: true;
  value: string;
}

/** Mark a string as pre-escaped HTML (will not be escaped by html``). */
export function raw(value: string): RawHtml {
  return { [RAW]: true, value };
}

/**
 * Tagged template literal that auto-escapes all interpolated values.
 * Use raw() to pass through pre-escaped HTML.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  let result = strings[0];
  for (let i = 0; i < values.length; i++) {
    const val = values[i];
    if (val != null && typeof val === 'object' && RAW in val) {
      result += (val as RawHtml).value;
    } else if (val != null) {
      result += escapeHtml(String(val));
    }
    result += strings[i + 1];
  }
  return result;
}

export function buildPlacePopup(place: PlacePopupData, cdnUrl?: string): string {
  let popup = '<div class="place-popup">';
  if (place.photo_key && cdnUrl) {
    popup += html`<img class="place-popup-photo" src="${cdnUrl}/cdn-cgi/image/width=280,height=160,fit=cover/${place.photo_key}" alt="" />`;
  }
  popup += html`<strong>${place.name}</strong>`;
  if (place.address) popup += html`<div class="place-popup-address">${place.address}</div>`;
  if (place.phone) popup += html`<div class="place-popup-phone">${place.phone}</div>`;
  const links: string[] = [];
  if (place.link) links.push(html`<a href="${place.link}" target="_blank" rel="noopener">Website</a>`);
  if (place.google_maps_url) links.push(html`<a href="${place.google_maps_url}" target="_blank" rel="noopener">Google Maps</a>`);
  if (links.length) popup += `<div class="place-popup-links">${links.join(' · ')}</div>`;
  popup += '</div>';
  return popup;
}
