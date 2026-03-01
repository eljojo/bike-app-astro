import polylineCodec from '@mapbox/polyline';

export function decodeToPoints(encoded: string): [number, number][] {
  return polylineCodec.decode(encoded).map(([lat, lon]: [number, number]) => [lat, lon]);
}

export function lowresPoints(points: [number, number][], precision = 4): [number, number][] {
  const factor = Math.pow(10, precision);
  return points.map(([lat, lon]) => [
    Math.round(lat * factor) / factor,
    Math.round(lon * factor) / factor,
  ]);
}

export function similarity(aPoints: [number, number][], bPoints: [number, number][]): number {
  const aLowres = lowresPoints(aPoints);
  const bLowres = lowresPoints(bPoints);

  const aSet = new Set(aLowres.map(p => `${p[0]},${p[1]}`));
  const bSet = new Set(bLowres.map(p => `${p[0]},${p[1]}`));

  let common = 0;
  for (const key of bSet) {
    if (aSet.has(key)) common++;
  }

  const maxPossible = Math.max(aSet.size, bSet.size);
  if (maxPossible === 0) return 0;
  return Math.round((100 * common) / maxPossible);
}

export function buildSimilarityMatrix(
  routes: { id: string; polyline: string }[],
): Record<string, Record<string, number>> {
  const decoded = routes.map(r => ({
    id: r.id,
    lowresSet: new Set(
      lowresPoints(decodeToPoints(r.polyline)).map(p => `${p[0]},${p[1]}`)
    ),
  }));

  const matrix: Record<string, Record<string, number>> = {};

  for (let i = 0; i < decoded.length; i++) {
    matrix[decoded[i].id] = {};
    for (let j = 0; j < decoded.length; j++) {
      if (i === j) continue;
      const a = decoded[i];
      const b = decoded[j];

      let common = 0;
      for (const key of b.lowresSet) {
        if (a.lowresSet.has(key)) common++;
      }

      const maxPossible = Math.max(a.lowresSet.size, b.lowresSet.size);
      const score = maxPossible > 0 ? Math.round((100 * common) / maxPossible) : 0;
      if (score > 0) {
        matrix[decoded[i].id][decoded[j].id] = score;
      }
    }
  }

  return matrix;
}

export function findSimilarRoutes(
  routeId: string,
  matrix: Record<string, Record<string, number>>,
  limit = 3,
  minScore = 10,
): { id: string; score: number }[] {
  const scores = matrix[routeId] || {};
  return Object.entries(scores)
    .filter(([, score]) => score >= minScore)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, score]) => ({ id, score }));
}
