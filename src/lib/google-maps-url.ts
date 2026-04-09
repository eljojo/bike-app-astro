const GMAPS_PATTERNS = [
  'maps.google.com',
  'google.com/maps',
  'goo.gl/maps',
  'maps.app.goo.gl',
];

export function isGoogleMapsUrl(text: string): boolean {
  return GMAPS_PATTERNS.some(p => text.includes(p));
}
