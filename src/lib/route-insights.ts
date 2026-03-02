import { haversine } from './gpx';

export function routeShape(points: { lat: number; lon: number }[], distance_m: number): string | null {
  if (points.length < 2) return null;
  const start = points[0];
  const end = points[points.length - 1];
  const dist = haversine(start, end);
  if (dist < 1000) return 'loop';
  if (distance_m > 0 && dist / distance_m > 0.4) return 'one-way';
  return 'out-and-back';
}

export function adjustedElevationGainPerKm(
  elevationGainM: number, netElevationM: number, distanceKm: number
): number {
  if (distanceKm <= 0) return 0;
  const effectiveGain = netElevationM < 0
    ? Math.max(0, elevationGainM + netElevationM)
    : elevationGainM;
  return effectiveGain / distanceKm;
}

export interface CategoryCount {
  category: string;
  count: number;
}

export function placeCounts(places: { category: string }[]): CategoryCount[] {
  if (places.length === 0) return [];

  const counts = new Map<string, number>();
  for (const p of places) {
    counts.set(p.category, (counts.get(p.category) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({ category, count }));
}
