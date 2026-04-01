import { haversineKm } from './proximity';

/**
 * Merge segments whose endpoints are within `maxGapKm` into continuous chains.
 * Greedy: for each unvisited segment, find the nearest unvisited segment whose
 * start is close to the current chain's end, and append it.
 * Returns the merged chains (each is an array of [lat, lng] points).
 */
export function mergeAdjacentSegments(segments: [number, number][][], maxGapKm: number): [number, number][][] {
  if (segments.length === 0) return [];
  const used = new Set<number>();
  const chains: [number, number][][] = [];

  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const chain = [...segments[i]];

    // Greedily extend the chain
    let extended = true;
    while (extended) {
      extended = false;
      const tail = chain[chain.length - 1];
      let bestIdx = -1;
      let bestDist = maxGapKm;
      let bestReverse = false;

      for (let j = 0; j < segments.length; j++) {
        if (used.has(j)) continue;
        const seg = segments[j];
        const dStart = haversineKm(tail[0], tail[1], seg[0][0], seg[0][1]);
        const dEnd = haversineKm(tail[0], tail[1], seg[seg.length - 1][0], seg[seg.length - 1][1]);
        if (dStart < bestDist) { bestDist = dStart; bestIdx = j; bestReverse = false; }
        if (dEnd < bestDist) { bestDist = dEnd; bestIdx = j; bestReverse = true; }
      }

      if (bestIdx >= 0) {
        used.add(bestIdx);
        const seg = bestReverse ? [...segments[bestIdx]].reverse() : segments[bestIdx];
        chain.push(...seg);
        extended = true;
      }
    }

    chains.push(chain);
  }

  return chains;
}
