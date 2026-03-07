interface PlacePopupData {
  name: string;
  description?: string;
  link?: string;
  google_maps_url?: string;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildPlacePopup(place: PlacePopupData): string {
  let popup = `<strong>${escapeHtml(place.name)}</strong>`;
  if (place.description) popup += `<br>${escapeHtml(place.description)}`;
  if (place.link) popup += `<br><a href="${escapeHtml(place.link)}" target="_blank">See more</a>`;
  if (place.google_maps_url) popup += `<br><a href="${escapeHtml(place.google_maps_url)}" target="_blank">Google Maps</a>`;
  return popup;
}
