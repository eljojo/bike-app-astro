export interface RouteElevationData {
  id: string;
  elevationGainPerKm: number;
}

export function difficultyRanking(
  routeId: string,
  routes: RouteElevationData[],
): { rank: number; total: number } | null {
  const sorted = [...routes].sort((a, b) => b.elevationGainPerKm - a.elevationGainPerKm);
  const index = sorted.findIndex(r => r.id === routeId);
  if (index === -1) return null;
  return { rank: index + 1, total: sorted.length };
}

export function routeShape(points: { lat: number; lon: number }[]): string | null {
  if (points.length < 2) return null;
  const start = points[0];
  const end = points[points.length - 1];
  const dist = haversineDistance(start, end);
  return dist < 1000 ? 'loop' : 'out & back';
}

function haversineDistance(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLon * sinLon;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

const CATEGORY_NAMES: Record<string, [string, string]> = {
  cafe: ['cafe', 'cafes'],
  restaurant: ['restaurant', 'restaurants'],
  park: ['park', 'parks'],
  beach: ['beach', 'beaches'],
  'bike-shop': ['bike shop', 'bike shops'],
  'bike-trail': ['trail', 'trails'],
  'water-fountain': ['water fountain', 'water fountains'],
  'chill-spot': ['chill spot', 'chill spots'],
  lookout: ['lookout', 'lookouts'],
  bridge: ['bridge', 'bridges'],
  poutine: ['poutine spot', 'poutine spots'],
  beer: ['brewery', 'breweries'],
  pizza: ['pizza spot', 'pizza spots'],
  'ice-cream': ['ice cream spot', 'ice cream spots'],
  'bike-rental': ['bike rental', 'bike rentals'],
  ferry: ['ferry', 'ferries'],
  parking: ['parking lot', 'parking lots'],
  'meeting-point': ['meeting point', 'meeting points'],
  'camping-spot': ['campsite', 'campsites'],
  wc: ['restroom', 'restrooms'],
};

export function placeSummary(places: { category: string }[]): string | null {
  if (places.length === 0) return null;

  const counts = new Map<string, number>();
  for (const p of places) {
    counts.set(p.category, (counts.get(p.category) || 0) + 1);
  }

  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat, count]) => {
      const names = CATEGORY_NAMES[cat] || [cat, cat + 's'];
      return `${count} ${count === 1 ? names[0] : names[1]}`;
    });

  return 'passes ' + parts.join(', ');
}
