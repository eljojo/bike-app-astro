interface PlacePopupData {
  name: string;
  description?: string;
  link?: string;
  google_maps_url?: string;
}

export function buildPlacePopup(place: PlacePopupData): string {
  let popup = `<strong>${place.name}</strong>`;
  if (place.description) popup += `<br>${place.description}`;
  if (place.link) popup += `<br><a href="${place.link}" target="_blank">See more</a>`;
  if (place.google_maps_url) popup += `<br><a href="${place.google_maps_url}" target="_blank">Google Maps</a>`;
  return popup;
}
