// scripts/pipeline/lib/way-connectivity.ts
//
// Geometry-based clustering of same-named ways into connected components.
//
// Union-find in three phases:
//   1. Merge ways sharing an OSM node (exact match)
//   2. Merge ways whose endpoints are within ENDPOINT_SNAP_M (mapping gaps)
//   3. Merge components whose bbox-to-bbox distance is within BBOX_MERGE_M
//      (road bike lanes with intersection gaps)
//
// Uses real geometry — never midpoints or centroids. See
// _ctx/spatial-reasoning.md.

const ENDPOINT_SNAP_M = 100;
const BBOX_MERGE_M = 2000;

/**
 * Split ways with the same name into connected components.
 *
 * "Trail 20" in the Greenbelt and "Trail 20" in Gatineau Park are
 * different trails — they share a name but have no geometric connection.
 * OVRT is one 30km trail — its ways chain continuously via shared nodes.
 *
 * Uses real geometry: shared OSM nodes first, then endpoint proximity
 * (100m tolerance) as a fallback for mapping gaps.
 */
export function splitWaysByConnectivity(ways: any[]): any[][] {
  if (ways.length <= 1) return [ways];

  // Union-find
  const parent = ways.map((_: any, i: number) => i);
  function find(i: number) {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  }
  function union(a: number, b: number) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  // Phase 1: merge ways that share an OSM node
  const nodeToWay = new Map();
  for (let i = 0; i < ways.length; i++) {
    for (const nodeId of ways[i].nodes || []) {
      if (nodeToWay.has(nodeId)) {
        union(i, nodeToWay.get(nodeId));
      } else {
        nodeToWay.set(nodeId, i);
      }
    }
  }

  // Phase 2: merge ways whose endpoints are within ENDPOINT_SNAP_M
  // Uses real endpoint coordinates from geometry, not midpoints.
  const endpoints = ways.map((w: any) => {
    if (!w.geometry?.length) return null;
    const g = w.geometry;
    return [
      { lat: g[0].lat, lon: g[0].lon },
      { lat: g[g.length - 1].lat, lon: g[g.length - 1].lon },
    ];
  });

  for (let i = 0; i < ways.length; i++) {
    if (!endpoints[i]) continue;
    for (let j = i + 1; j < ways.length; j++) {
      if (!endpoints[j]) continue;
      if (find(i) === find(j)) continue;
      // Check all 4 endpoint pairs
      for (const a of endpoints[i]!) {
        for (const b of endpoints[j]!) {
          const dlat = (a.lat - b.lat) * 111320;
          const dlng = (a.lon - b.lon) * 111320 * Math.cos(a.lat * Math.PI / 180);
          if (dlat * dlat + dlng * dlng < ENDPOINT_SNAP_M * ENDPOINT_SNAP_M) {
            union(i, j);
          }
        }
      }
    }
  }

  // Phase 3: merge components whose real geometry bounding boxes are
  // within 2km. Catches road bike lanes with intersection gaps — the
  // segments are disconnected but clearly the same road facility.
  // Uses bbox edges (real geometry extent), not midpoints or centers.
  const bboxOf = (indices: number[]) => {
    let s = Infinity, n = -Infinity, w = Infinity, e = -Infinity;
    for (const i of indices) {
      for (const pt of ways[i].geometry || []) {
        if (pt.lat < s) s = pt.lat;
        if (pt.lat > n) n = pt.lat;
        if (pt.lon < w) w = pt.lon;
        if (pt.lon > e) e = pt.lon;
      }
    }
    return { s, n, w, e };
  };
  const components = new Map<number, number[]>();
  for (let i = 0; i < ways.length; i++) {
    const root = find(i);
    if (!components.has(root)) components.set(root, []);
    components.get(root)!.push(i);
  }
  const roots = [...components.keys()];
  const bboxes = new Map(roots.map(r => [r, bboxOf(components.get(r)!)]));
  for (let i = 0; i < roots.length; i++) {
    for (let j = i + 1; j < roots.length; j++) {
      if (find(roots[i]) === find(roots[j])) continue;
      const a = bboxes.get(roots[i])!, b = bboxes.get(roots[j])!;
      // Min distance between bbox edges (not centers)
      const latGap = Math.max(0, Math.max(a.s, b.s) - Math.min(a.n, b.n)) * 111320;
      const lonGap = Math.max(0, Math.max(a.w, b.w) - Math.min(a.e, b.e)) * 111320 *
        Math.cos(((a.s + a.n) / 2) * Math.PI / 180);
      if (Math.sqrt(latGap * latGap + lonGap * lonGap) < BBOX_MERGE_M) {
        union(roots[i], roots[j]);
      }
    }
  }

  const groups = new Map<number, any[]>();
  for (let i = 0; i < ways.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(ways[i]);
  }
  return [...groups.values()];
}
