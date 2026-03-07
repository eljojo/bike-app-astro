interface PlacePopupData {
  name: string;
  description?: string;
  link?: string;
  google_maps_url?: string;
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

export function buildPlacePopup(place: PlacePopupData): string {
  let popup = html`<strong>${place.name}</strong>`;
  if (place.description) popup += html`<br>${place.description}`;
  if (place.link) popup += html`<br><a href="${place.link}" target="_blank">See more</a>`;
  if (place.google_maps_url) popup += html`<br><a href="${place.google_maps_url}" target="_blank">Google Maps</a>`;
  return popup;
}
