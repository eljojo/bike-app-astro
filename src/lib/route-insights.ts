import { haversine } from './gpx';

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
  const dist = haversine(start, end);
  return dist < 1000 ? 'loop' : 'out-and-back';
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
