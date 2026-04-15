/**
 * Axis-aligned bounding box helpers shared between the build-time view model
 * and client-side map code.
 *
 * Both callers need the same shape (a tuple compatible with MapLibre's
 * fitBounds), but they consume different input geometries — the view model
 * walks point arrays keyed `{lat, lng}`, while the map code walks GeoJSON
 * feature coordinates keyed `[lng, lat]`. Each shape gets its own entry point
 * to keep the loop body branch-free.
 */

/** [minLng, minLat, maxLng, maxLat] — GeoJSON / MapLibre order. */
export type Bounds = [number, number, number, number];

/** Compute a bounding box from `{lat, lng}` points. Returns null when empty. */
export function boundsFromPoints(
  points: Iterable<{ lat: number; lng: number }>,
): Bounds | null {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  let any = false;
  for (const p of points) {
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    any = true;
  }
  return any ? [minLng, minLat, maxLng, maxLat] : null;
}

/** Compute a bounding box from `[lng, lat]` coordinate pairs. Returns null when empty. */
export function boundsFromCoords(
  coords: Iterable<[number, number]>,
): Bounds | null {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  let any = false;
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    any = true;
  }
  return any ? [minLng, minLat, maxLng, maxLat] : null;
}

/** Unpack a Bounds tuple into MapLibre fitBounds' [[sw], [ne]] shape. */
export function toFitBoundsArg(b: Bounds): [[number, number], [number, number]] {
  return [[b[0], b[1]], [b[2], b[3]]];
}
