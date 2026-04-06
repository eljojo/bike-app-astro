// cluster-entries.ts
import { haversineM, corridorWidth } from './geo.mjs';
import { pathTypeForClustering } from '../../../src/lib/bike-paths/classify-path.ts';

// Type-based corridor width limits. Trails in parks span large areas
// (Gatineau Park is 20km across) — a single limit blocks legitimate
// connections. Urban paved cycleways need a tighter limit to prevent
// mega-groups from chaining through shared intersection nodes.
const CORRIDOR_WIDTH_BY_TYPE: Record<string, number> = {
  trail: 20000,  // 20km — parks, forests, conservation areas
  paved: 3000,   // 3km — urban MUPs, separated cycleways
  road: 2000,    // 2km — parallel bike lanes along roads
};
const DEFAULT_CORRIDOR_WIDTH_M = 3000; // for null/unknown pathType

function operatorsCompatible(a: string | undefined, b: string | undefined) {
  if (!a || !b) return true;
  return a === b;
}

function typesCompatible(a: string | null, b: string | null) {
  if (!a || !b) return true; // unknown type merges with anything
  return a === b;
}

// Type-based endpoint proximity thresholds. Trail junctions in forests
// are imprecise — endpoints 20-40m apart are clearly the same junction.
// Urban paved paths are precisely mapped.
const TOUCHING_M_BY_TYPE: Record<string, number> = {
  trail: 1200, // forest trail systems — separate trailheads linked by unmarked paths
  paved: 10,   // urban MUPs — precisely mapped
  road: 10,    // parallel lanes — precise
};
const DEFAULT_TOUCHING_M = 10;

export function clusterByConnectivity(entries: any[]) {
  const withWays = entries
    .map((e, i) => ({ entry: e, index: i }))
    .filter(({ entry }) => entry._ways && entry._ways.length > 0);

  const n = withWays.length;
  if (n < 2) return [];

  const parent = Array.from({ length: n }, (_, i) => i);
  function find(i: number) {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  }

  const entryTypes = withWays.map(({ entry }) => pathTypeForClustering(entry));
  const entryEndpoints = withWays.map(({ entry }) => {
    const eps = [];
    for (const way of entry._ways) {
      if (way.length >= 1) {
        eps.push(way[0]);
        if (way.length >= 2) eps.push(way[way.length - 1]);
      }
    }
    return eps;
  });

  const compEndpoints = entryEndpoints.map(eps =>
    eps.map((p: { lon: number; lat: number }) => [p.lon, p.lat])
  );

  function tryUnion(i: number, j: number) {
    const ri = find(i), rj = find(j);
    if (ri === rj) return;
    if (!operatorsCompatible(withWays[ri].entry.operator, withWays[rj].entry.operator)) return;
    if (!typesCompatible(entryTypes[i], entryTypes[j])) return;
    const mergedPts = [...compEndpoints[ri], ...compEndpoints[rj]];
    // Use the wider limit of the two types — if one is a trail, use trail limit
    const typeI = entryTypes[i], typeJ = entryTypes[j];
    const limitI = CORRIDOR_WIDTH_BY_TYPE[typeI ?? ''] ?? DEFAULT_CORRIDOR_WIDTH_M;
    const limitJ = CORRIDOR_WIDTH_BY_TYPE[typeJ ?? ''] ?? DEFAULT_CORRIDOR_WIDTH_M;
    const limit = Math.max(limitI, limitJ);
    if (corridorWidth(mergedPts as [number, number][]) > limit) return;
    parent[ri] = rj;
    compEndpoints[rj] = mergedPts;
  }

  // Phase 1: Exact shared-node detection via coordinate-string inverted index
  const nodeIndex = new Map();
  for (let ei = 0; ei < n; ei++) {
    for (const way of withWays[ei].entry._ways) {
      for (const node of way) {
        const key = `${node.lat},${node.lon}`;
        if (!nodeIndex.has(key)) nodeIndex.set(key, new Set());
        nodeIndex.get(key).add(ei);
      }
    }
  }

  for (const [, entrySet] of nodeIndex) {
    if (entrySet.size < 2) continue;
    const indices = [...entrySet];
    for (let a = 1; a < indices.length; a++) {
      tryUnion(indices[0], indices[a]);
    }
  }

  // Phase 2: Endpoint proximity — type-based threshold.
  // Trail systems in forests have separate trailheads up to ~1km apart.
  // Grid cell size covers the max threshold (1200m ≈ 0.011°).
  const maxTouching = Math.max(...Object.values(TOUCHING_M_BY_TYPE), DEFAULT_TOUCHING_M);
  const EP_GRID = maxTouching / 111320 * 1.1; // slightly larger than max threshold in degrees
  const epGrid = new Map();
  for (let ei = 0; ei < n; ei++) {
    for (const ep of entryEndpoints[ei]) {
      const gx = Math.floor(ep.lon / EP_GRID);
      const gy = Math.floor(ep.lat / EP_GRID);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const key = `${gx + dx},${gy + dy}`;
          if (!epGrid.has(key)) epGrid.set(key, []);
          epGrid.get(key).push({ entryIdx: ei, lon: ep.lon, lat: ep.lat });
        }
      }
    }
  }

  for (const [, eps] of epGrid) {
    for (let a = 0; a < eps.length; a++) {
      for (let b = a + 1; b < eps.length; b++) {
        if (eps[a].entryIdx === eps[b].entryIdx) continue;
        if (find(eps[a].entryIdx) === find(eps[b].entryIdx)) continue;
        const d = haversineM([eps[a].lon, eps[a].lat], [eps[b].lon, eps[b].lat]);
        // Use the wider threshold of the two types
        const typeA = entryTypes[eps[a].entryIdx];
        const typeB = entryTypes[eps[b].entryIdx];
        const limitA = TOUCHING_M_BY_TYPE[typeA ?? ''] ?? DEFAULT_TOUCHING_M;
        const limitB = TOUCHING_M_BY_TYPE[typeB ?? ''] ?? DEFAULT_TOUCHING_M;
        if (d <= Math.max(limitA, limitB)) {
          tryUnion(eps[a].entryIdx, eps[b].entryIdx);
        }
      }
    }
  }

  // Build result clusters
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(withWays[i].entry);
  }

  return [...groups.values()]
    .filter((members: any[]) => members.length >= 2)
    .map((members: any[]) => {
      const allAnchors = members.flatMap((m: any) => m.anchors || []);
      const lngs = allAnchors.map((a: any) => a[0]);
      const lats = allAnchors.map((a: any) => a[1]);

      const existingGroup = members.find((m: any) => m.type === 'network');
      const newMembers = existingGroup
        ? members.filter((m: any) => m !== existingGroup)
        : members;

      return {
        members,
        bbox: {
          south: Math.min(...lats), north: Math.max(...lats),
          west: Math.min(...lngs), east: Math.max(...lngs),
        },
        centroid: {
          lat: lats.reduce((a: number, b: number) => a + b, 0) / lats.length,
          lon: lngs.reduce((a: number, b: number) => a + b, 0) / lngs.length,
        },
        existingGroup: existingGroup || null,
        newMembers,
      };
    });
}

