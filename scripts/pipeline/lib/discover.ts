// scripts/pipeline/lib/discover.ts
//
// All 5 OSM discovery steps. Each step is a private function.
// Exports one discover() function that runs them in order.

import type { PipelineContext, OsmRelation, NamedWayEntry, ParallelLaneCandidate, NonCyclingCandidate, DiscoveredData } from './pipeline-types.ts';
import type { WayRegistry } from './way-registry.mjs';
import { mergeWayTags } from './osm-tags.ts';
import { haversineM } from './geo.mjs';
import { chainSegments } from './chain-segments.mjs';
import { selectBestRoad } from './select-best-road.mjs';
import { defaultParallelLaneFilter } from './city-adapter.mjs';
import { rankByGeomDistance } from './nearest-park.mjs';
import { slugifyBikePathName as slugify } from '../../../src/lib/bike-paths/bikepaths-yml.server.ts';

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Group chains with the same road name only if their bboxes are within proximityM of each other.
 * Same road name far apart = separate entries.
 */
function groupByRoadAndProximity(results: any[], proximityM: number): ParallelLaneCandidate[] {
  const groups: any[] = [];

  for (const r of results) {
    let merged = false;
    for (const g of groups) {
      if (g.roadName !== r.roadName) continue;
      if (bboxDistance(g.bbox, r.chain.bbox) <= proximityM) {
        g.chains.push(r.chain);
        g.allTags.push(...r.chain.tags);
        g.bbox = mergeBboxes(g.bbox, r.chain.bbox);
        merged = true;
        break;
      }
    }
    if (!merged) {
      groups.push({
        roadName: r.roadName,
        chains: [r.chain],
        allTags: [...r.chain.tags],
        bbox: { ...r.chain.bbox },
      });
    }
  }

  return groups.map(g => ({
    name: g.roadName,
    parallel_to: g.roadName,
    anchors: [
      [g.bbox.west, g.bbox.south],
      [g.bbox.east, g.bbox.north],
    ] as [number, number][],
    tags: mergeWayTags(g.allTags.map((t: any, i: number) => ({ tags: t, id: i }))),
  }));
}

function bboxDistance(a: any, b: any): number {
  if (a.south <= b.north && a.north >= b.south && a.west <= b.east && a.east >= b.west) return 0;
  const latA = (a.south + a.north) / 2;
  const lngA = (a.west + a.east) / 2;
  const latB = (b.south + b.north) / 2;
  const lngB = (b.west + b.east) / 2;
  return haversineM([lngA, latA], [lngB, latB]);
}

function mergeBboxes(a: any, b: any) {
  return {
    south: Math.min(a.south, b.south),
    north: Math.max(a.north, b.north),
    west: Math.min(a.west, b.west),
    east: Math.max(a.east, b.east),
  };
}

/**
 * Split ways with the same name into connected components.
 * "Trail 20" in the Greenbelt and "Trail 20" in Gatineau Park are
 * different trails — they share a name but have no geometric connection.
 * OVRT is one 30km trail — its ways chain continuously via shared nodes.
 *
 * Uses real geometry: shared OSM nodes first, then endpoint proximity
 * (100m tolerance) as a fallback for mapping gaps. Never midpoints.
 */
const ENDPOINT_SNAP_M = 100;

function splitWaysByConnectivity(ways: any[]): any[][] {
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
  const BBOX_MERGE_M = 2000;
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

// Token-based name similarity for fragment merging.
// Tokenize, hard-reject on numeric mismatch, soft Dice with edit-distance-1 tolerance.
function namesAreSimilar(a: string, b: string): boolean {
  const tokenize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\(.*?\)/g, '').match(/[a-z0-9]+/g) || [];
  const editDist1 = (s: string, t: string) => {
    if (Math.abs(s.length - t.length) > 1) return false;
    let diffs = 0;
    if (s.length === t.length) {
      for (let i = 0; i < s.length; i++) { if (s[i] !== t[i]) diffs++; }
      return diffs === 1;
    }
    // length differs by 1 — check for single insertion
    const [short, long] = s.length < t.length ? [s, t] : [t, s];
    let si = 0;
    for (let li = 0; li < long.length; li++) {
      if (short[si] === long[li]) si++;
      else diffs++;
      if (diffs > 1) return false;
    }
    return true;
  };

  const tokA = tokenize(a), tokB = tokenize(b);
  if (tokA.length < 2 || tokB.length < 2) return false;

  // Hard reject: if any numeric token in A has no match in B
  const numA = tokA.filter(t => /^\d+$/.test(t));
  const numB = tokB.filter(t => /^\d+$/.test(t));
  if (numA.length > 0 || numB.length > 0) {
    if (numA.sort().join(',') !== numB.sort().join(',')) return false;
  }

  // Soft Dice: tokens match if identical or (both >= 4 chars and edit distance 1)
  const usedB = new Set<number>();
  let matched = 0;
  for (const ta of tokA) {
    for (let j = 0; j < tokB.length; j++) {
      if (usedB.has(j)) continue;
      const tb = tokB[j];
      if (ta === tb || (ta.length >= 4 && tb.length >= 4 && editDist1(ta, tb))) {
        matched++;
        usedB.add(j);
        break;
      }
    }
  }
  const dice = (2 * matched) / (tokA.length + tokB.length);
  return dice >= 0.85 && matched >= 2;
}

// ---------------------------------------------------------------------------
// Step 1: Discover cycling relations
// ---------------------------------------------------------------------------

async function discoverRelations(ctx: PipelineContext, wayRegistry: WayRegistry): Promise<{ osmRelations: OsmRelation[]; relationBaseNames: Set<string> }> {
  console.log('Discovering cycling relations from OSM...');
  const relQ = `[out:json][timeout:120];
(
  relation["route"="bicycle"](${ctx.bbox});
  relation["route"="mtb"](${ctx.bbox});
  relation["type"="route"]["name"~"${ctx.adapter.relationNamePattern}"](${ctx.bbox});
);
out tags;`;
  const relData = await ctx.queryOverpass(relQ);
  const CYCLING_ROUTES = new Set(['bicycle', 'mtb']);
  const osmRelations: OsmRelation[] = relData.elements
    .filter((el: any) => el.tags?.type !== 'superroute') // superroutes are containers, handled by network discovery
    .filter((el: any) => {
      // The name-pattern clause (third) catches any type=route with a matching
      // name, regardless of route tag. Filter out non-cycling relations (hiking,
      // skiing, piste) that slipped in — they claim ways and block real cycling
      // entries from becoming standalone.
      const route = el.tags?.route;
      if (route && !CYCLING_ROUTES.has(route)) {
        console.log(`  Skipping non-cycling relation ${el.id} "${el.tags?.name}" (route=${route})`);
        return false;
      }
      return true;
    })
    .map((el: any) => ({
      id: el.id,
      name: el.tags?.name || `relation-${el.id}`,
      tags: el.tags || {},
    }));
  console.log(`  Found ${osmRelations.length} cycling relations`);

  // Step 1a: Fetch member way IDs for each relation (for structural dedup).
  // The discovery query above uses `out tags;` which only returns tags.
  // We need `out body;` to get member lists with way IDs.
  if (osmRelations.length > 0) {
    const relIds = osmRelations.map(r => r.id);
    const bodyQ = `[out:json][timeout:120];\n(\n${relIds.map(id => `  relation(${id});`).join('\n')}\n);\nout body;`;
    try {
      const bodyData = await ctx.queryOverpass(bodyQ);
      const bodyById = new Map();
      for (const el of bodyData.elements) {
        if (el.members) bodyById.set(el.id, el.members);
      }
      for (const rel of osmRelations) {
        const members = bodyById.get(rel.id);
        if (members) {
          rel._memberWayIds = members.filter((m: any) => m.type === 'way').map((m: any) => m.ref);
        }
      }
      const totalWays = osmRelations.reduce((n, r) => n + (r._memberWayIds?.length || 0), 0);
      console.log(`  Fetched member way IDs: ${totalWays} ways across ${bodyById.size} relations`);
    } catch (err: any) {
      console.error(`  Failed to fetch relation member way IDs: ${err.message}`);
    }
  }

  // Filter out mega-MTB-relations: local MTB relations with many member ways
  // are aggregations of an entire trail system (e.g. "Sentier vélo de Montagne
  // - Parc de la Gatineau" with 95 ways). These claim individual named trails'
  // ways, preventing them from becoming standalone entries. The individual
  // trails are better discovered as named ways (step 2) and grouped into
  // networks by park containment.
  // Exclude long-distance MTB routes (ncn/rcn/ref) — those are touring routes.
  const MEGA_MTB_THRESHOLD = 50;
  const megaMtbIds = new Set<number>();
  for (let i = osmRelations.length - 1; i >= 0; i--) {
    const r = osmRelations[i];
    if (r.tags?.route !== 'mtb') continue;
    if ((r._memberWayIds?.length || 0) <= MEGA_MTB_THRESHOLD) continue;
    if (r.tags?.network || r.tags?.ref) continue;
    console.log(`  Skipping mega-MTB relation ${r.id} "${r.name}" (${r._memberWayIds!.length} ways)`);
    megaMtbIds.add(r.id);
    osmRelations.splice(i, 1);
  }

  // Step 1a-2: Fetch way-level tags for relation members.
  // Route relations typically lack physical tags (highway, surface, width,
  // lit) — those live on the member ways. Aggregate them via majority vote
  // so relation entries get correct classification in derivePathType().
  if (osmRelations.length > 0) {
    const wayIdToRels = new Map<number, OsmRelation[]>();
    for (const rel of osmRelations) {
      for (const wid of (rel._memberWayIds || [])) {
        if (!wayIdToRels.has(wid)) wayIdToRels.set(wid, []);
        wayIdToRels.get(wid)!.push(rel);
      }
    }
    const allWayIds = [...wayIdToRels.keys()];
    if (allWayIds.length > 0) {
      const wayTagQ = `[out:json][timeout:120];\nway(id:${allWayIds.join(',')});\nout geom tags;`;
      try {
        const wayTagData = await ctx.queryOverpass(wayTagQ);
        const waysByRel = new Map<number, any[]>();
        for (const el of wayTagData.elements) {
          const rels = wayIdToRels.get(el.id);
          if (!rels) continue;
          for (const rel of rels) {
            if (!waysByRel.has(rel.id)) waysByRel.set(rel.id, []);
            waysByRel.get(rel.id)!.push(el);
          }
        }
        let enrichedCount = 0;
        for (const rel of osmRelations) {
          const ways = waysByRel.get(rel.id);
          if (ways && ways.length > 0) {
            rel._aggregatedWayTags = mergeWayTags(ways);
            enrichedCount++;
          }
        }
        console.log(`  Aggregated way-level tags for ${enrichedCount} relations`);
      } catch (err: any) {
        console.error(`  Failed to fetch way-level tags: ${err.message}`);
      }
    }
  }

  // Step 1b: Resolve relation base names for ghost entry removal in step 8c.
  // Named ways sometimes duplicate relation entries (e.g. "Ottawa River Pathway"
  // ways create ghost entries alongside "Ottawa River Pathway (east)" relations).
  // We collect the base names here and remove the ghosts after the full pipeline.
  const relationBaseNames = new Set(osmRelations.map(r =>
    r.name.replace(/\s*\(.*?\)\s*$/, '').toLowerCase()
  ));

  return { osmRelations, relationBaseNames };
}

// ---------------------------------------------------------------------------
// Step 2: Discover named cycling ways
// ---------------------------------------------------------------------------

async function discoverNamedWays(ctx: PipelineContext, osmRelations: OsmRelation[], wayRegistry: WayRegistry): Promise<NamedWayEntry[]> {
  console.log('Discovering named cycling ways from OSM...');
  const namedWayQueries = ctx.adapter.namedWayQueries(ctx.bbox);
  const allWayElements: any[] = [];
  for (const { label, q } of namedWayQueries) {
    try {
      const data = await ctx.queryOverpass(q);
      console.log(`  ${label}: ${data.elements.length} ways`);
      allWayElements.push(...data.elements);
    } catch (err: any) {
      console.error(`  ${label}: failed (${err.message})`);
    }
  }

  const waysByName = new Map<string, any[]>();
  for (const el of allWayElements) {
    const name = el.tags?.name;
    if (!name) continue;
    if (!waysByName.has(name)) waysByName.set(name, []);
    waysByName.get(name)!.push(el);
  }

  // Fetch non-cycling junction ways that share nodes with cycling ways.
  // Trails in parks connect through hiking-only segments (bicycle:no).
  const cyclingWayIds = allWayElements.filter((e: any) => e.id).map((e: any) => e.id);
  const allWaysByName = new Map<string, any[]>();
  if (cyclingWayIds.length > 0) {
    const junctionQ = `[out:json][timeout:180];
way(id:${cyclingWayIds.join(',')});
node(w);
way(bn)["name"]["highway"~"path|footway|cycleway"](${ctx.bbox});
out geom tags;`;
    try {
      const junctionData = await ctx.queryOverpass(junctionQ);
      const cyclingIdSet = new Set(cyclingWayIds);
      for (const el of junctionData.elements) {
        if (el.type !== 'way') continue;
        if (cyclingIdSet.has(el.id)) continue;
        const name = el.tags?.name;
        if (!name) continue;
        if (!allWaysByName.has(name)) allWaysByName.set(name, []);
        allWaysByName.get(name)!.push(el);
      }

      let junctionCount = 0;
      for (const [name, ways] of allWaysByName) {
        if (waysByName.has(name)) continue;
        const anchors: any[] = [];
        for (const w of ways) {
          if (w.geometry?.length >= 2) {
            anchors.push([w.geometry[0].lon, w.geometry[0].lat]);
            anchors.push([w.geometry[w.geometry.length - 1].lon, w.geometry[w.geometry.length - 1].lat]);
          }
        }
        if (anchors.length > 0) {
          waysByName.set(name, ways);
          junctionCount++;
        }
      }
      if (junctionCount > 0) console.log(`  Found ${junctionCount} non-cycling junction trails`);
    } catch (err: any) {
      console.error(`  Junction ways fetch failed: ${err.message}`);
    }
  }

  // Build named way entries. Split same-named ways that are geographically
  // far apart — "Trail 20" in the Greenbelt (45.32°N) and "Trail 20" in
  // Gatineau Park (45.52°N) are different trails that happen to share a name.
  const osmNamedWays: NamedWayEntry[] = [];
  for (const [name, ways] of waysByName) {
    // Split same-named ways into connected components using real geometry.
    // Shared OSM nodes + 100m endpoint snap. OVRT (one continuous trail)
    // stays one entry. Trail 20 in different parks stays separate.
    const wayClusters = splitWaysByConnectivity(ways);

    for (const clusterWays of wayClusters) {
      const anchors: [number, number][] = [];
      for (const w of clusterWays) {
        if (w.geometry?.length >= 2) {
          anchors.push([w.geometry[0].lon, w.geometry[0].lat]);
          anchors.push([w.geometry[w.geometry.length - 1].lon, w.geometry[w.geometry.length - 1].lat]);
        } else if (w.center) {
          anchors.push([w.center.lon, w.center.lat]);
        }
      }
      if (anchors.length === 0) continue;

      // Include junction ways that share nodes or have endpoints near
      // THIS cluster's ways (not all junction ways with the same name).
      const clusterNodeIds = new Set(clusterWays.flatMap((w: any) => w.nodes || []));
      const junctionWays = (allWaysByName.get(name) || []).filter((jw: any) => {
        // Shared nodes
        if (jw.nodes?.some((n: any) => clusterNodeIds.has(n))) return true;
        // Endpoint proximity (100m)
        if (!jw.geometry?.length) return false;
        const jwEps = [jw.geometry[0], jw.geometry[jw.geometry.length - 1]];
        for (const cw of clusterWays) {
          if (!cw.geometry?.length) continue;
          const cwEps = [cw.geometry[0], cw.geometry[cw.geometry.length - 1]];
          for (const a of jwEps) {
            for (const b of cwEps) {
              const dlat = (a.lat - b.lat) * 111320;
              const dlng = (a.lon - b.lon) * 111320 * Math.cos(a.lat * Math.PI / 180);
              if (dlat * dlat + dlng * dlng < 10000) return true; // 100m
            }
          }
        }
        return false;
      });

      const seenIds = new Set<number>();
      const combinedWays: any[] = [];
      for (const w of [...clusterWays, ...junctionWays]) {
        if (!w.geometry?.length || w.geometry.length < 2) continue;
        if (w.id && seenIds.has(w.id)) continue;
        if (w.id) seenIds.add(w.id);
        combinedWays.push(w.geometry);
      }

      osmNamedWays.push({
        name,
        wayCount: clusterWays.length,
        tags: mergeWayTags(clusterWays),
        anchors,
        osmNames: [name],
        _ways: combinedWays.length > 0 ? combinedWays : clusterWays.filter((w: any) => w.geometry?.length >= 2).map((w: any) => w.geometry),
        _wayIds: clusterWays.filter((w: any) => w.id).map((w: any) => w.id),
      });
    }
  }

  // Merge small fragments into nearby larger entries with similar names.
  // "Voie Verte de Chelsea" (0.2km) is a typo variant of "Voie Verte Chelsea"
  // (22km). Relative to the trail length, the fragment is insignificant.
  // Absorb it: merge its _ways into the larger entry and drop it.
  const absorbed = new Set<number>();
  for (let i = 0; i < osmNamedWays.length; i++) {
    const small = osmNamedWays[i];
    if (absorbed.has(i)) continue;
    for (let j = 0; j < osmNamedWays.length; j++) {
      if (i === j || absorbed.has(j)) continue;
      const large = osmNamedWays[j];
      if (large.wayCount <= small.wayCount) continue; // large must be bigger

      // Skip exact same name — splitWaysByConnectivity already decided
      // these are different trails in different parks.
      if (small.name === large.name) continue;
      if (slugify(small.name) === slugify(large.name)) continue;

      // Token-based soft Dice similarity (Codex recommendation).
      // Language-agnostic, handles typos (vert/verte), particles (de/du),
      // parentheticals. Hard rejects numeric token mismatches (Trail 22 ≠ Trail 24).
      if (!namesAreSimilar(small.name, large.name)) continue;

      // Geographically close?
      if (!small.anchors?.length || !large.anchors?.length) continue;
      if (haversineM(small.anchors[0], large.anchors[0]) > 10000) continue;

      // Small relative to large? (< 20% way count)
      if (small.wayCount > large.wayCount * 0.2) continue;

      // Absorb: merge small's _ways into large, drop small
      large._ways = [...(large._ways || []), ...(small._ways || [])];
      large.anchors = [...large.anchors, ...small.anchors];
      absorbed.add(i);
      break;
    }
  }
  if (absorbed.size > 0) {
    const before = osmNamedWays.length;
    for (const idx of [...absorbed].sort((a, b) => b - a)) {
      osmNamedWays.splice(idx, 1);
    }
    console.log(`  Merged ${absorbed.size} small fragments into larger entries (${before} → ${osmNamedWays.length})`);
  }

  console.log(`  Found ${osmNamedWays.length} named cycling ways`);
  return osmNamedWays;
}

// ---------------------------------------------------------------------------
// Step 2b: Discover unnamed parallel bike lanes
// ---------------------------------------------------------------------------

async function discoverParallelLanes(ctx: PipelineContext): Promise<ParallelLaneCandidate[]> {
  console.log('Discovering unnamed parallel bike lanes...');
  const filter = (ctx.adapter.parallelLaneFilter || defaultParallelLaneFilter);
  const plQ = `[out:json][timeout:120];
way["highway"="cycleway"][!"name"][!"crossing"](${ctx.bbox});
out tags center;`;
  const plData = await ctx.queryOverpass(plQ);
  const plCandidates = plData.elements.filter((el: any) => filter(el.tags || {}));
  let parallelLanes: ParallelLaneCandidate[] = [];
  if (plCandidates.length > 0) {
    const segments = plCandidates.map((el: any) => ({ id: el.id, center: el.center, tags: el.tags || {} }));
    const chains = chainSegments(segments, 50);
    const results: any[] = [];
    for (const chain of chains) {
      const { lat, lon } = chain.midpoint;
      const roadQ = `[out:json][timeout:15];
way["highway"~"^(primary|secondary|tertiary|residential|unclassified)$"]["name"]
  (around:30,${lat},${lon});
out tags center;`;
      try {
        const roadData = await ctx.queryOverpass(roadQ);
        if (roadData.elements.length === 0) continue;
        const best = selectBestRoad(roadData.elements, { lat, lon });
        if (!best) continue;
        results.push({
          roadName: best.name,
          chain,
          tags: mergeWayTags(chain.tags.map((t: any, i: number) => ({ tags: t, id: chain.segmentIds[i] }))),
        });
      } catch {}
    }
    parallelLanes = groupByRoadAndProximity(results, 500);
    console.log(`  ${parallelLanes.length} parallel lane candidates`);
  }
  return parallelLanes;
}

// ---------------------------------------------------------------------------
// Step 2c: Discover unnamed cycling chains (park paths, greenway corridors)
// ---------------------------------------------------------------------------

async function discoverUnnamedChains(ctx: PipelineContext, osmNamedWays: NamedWayEntry[], osmRelations: OsmRelation[]): Promise<void> {
  console.log('Discovering unnamed cycling chains...');
  const MIN_CHAIN_LENGTH_M = 1500;
  const unchainedQ = `[out:json][timeout:120];
way["highway"~"cycleway|path"]["bicycle"~"designated|yes"][!"name"][!"crossing"](${ctx.bbox});
out geom tags;`;
  const unchainedData = await ctx.queryOverpass(unchainedQ);
  const unchainedWays = unchainedData.elements.filter((w: any) => w.geometry?.length >= 2);

  const ucEpIndex = new Map<string, number[]>();
  for (let i = 0; i < unchainedWays.length; i++) {
    const g = unchainedWays[i].geometry;
    for (const pt of [g[0], g[g.length - 1]]) {
      const key = pt.lat.toFixed(7) + ',' + pt.lon.toFixed(7);
      if (!ucEpIndex.has(key)) ucEpIndex.set(key, []);
      ucEpIndex.get(key)!.push(i);
    }
  }
  const ucParent = Array.from({ length: unchainedWays.length }, (_, i) => i);
  function ucFind(x: number) { while (ucParent[x] !== x) { ucParent[x] = ucParent[ucParent[x]]; x = ucParent[x]; } return x; }
  for (const [, indices] of ucEpIndex) {
    for (let i = 1; i < indices.length; i++) {
      const ra = ucFind(indices[0]), rb = ucFind(indices[i]);
      if (ra !== rb) ucParent[ra] = rb;
    }
  }

  const ucGroups = new Map<number, number[]>();
  for (let i = 0; i < unchainedWays.length; i++) {
    const root = ucFind(i);
    if (!ucGroups.has(root)) ucGroups.set(root, []);
    ucGroups.get(root)!.push(i);
  }

  function wayLength(g: any[]) {
    let len = 0;
    for (let i = 1; i < g.length; i++) {
      const dlat = (g[i].lat - g[i - 1].lat) * 111320;
      const dlng = (g[i].lon - g[i - 1].lon) * 111320 * Math.cos(g[i].lat * Math.PI / 180);
      len += Math.sqrt(dlat * dlat + dlng * dlng);
    }
    return len;
  }

  const unnamedChains: string[] = [];
  for (const [, indices] of ucGroups) {
    let totalLen = 0;
    for (const i of indices) totalLen += wayLength(unchainedWays[i].geometry);
    if (totalLen < MIN_CHAIN_LENGTH_M) continue;

    // All naming queries use the chain's real geometry, never a midpoint.
    const chainWayIds = indices.map(i => unchainedWays[i].id).join(',');
    const chainPts = indices.flatMap(i => unchainedWays[i].geometry);

    // Name the chain from the closest named feature by real geometry.
    // Query parks (500m) and roads (100m) around the chain's actual ways,
    // then pick whichever is closest. A road 20m away beats a park 300m
    // away — the chain parallels the road, not the park.
    let chainName: string | null = null;

    // 1. Check containment first (is_in) — if the chain is INSIDE a park,
    //    that's the strongest signal. Sample multiple points along the chain.
    try {
      const samplePts: any[] = [];
      for (const i of indices) {
        const g = unchainedWays[i].geometry;
        samplePts.push(g[0], g[Math.floor(g.length / 2)], g[g.length - 1]);
      }
      for (const pt of samplePts) {
        if (chainName) break;
        try {
          const isInData = await ctx.queryOverpass(`[out:json][timeout:15];
is_in(${pt.lat},${pt.lon})->.a;
area.a["leisure"~"park|nature_reserve"]["name"]->.b;
area.a["landuse"~"recreation_ground"]["name"]->.c;
area.a["natural"="wood"]["name"]->.d;
(.b; .c; .d;);
out tags;`);
          if (isInData.elements.length > 0) {
            chainName = isInData.elements[0].tags?.name;
          }
        } catch {}
      }
    } catch {}

    // 2. If not inside a park, find the closest named feature — park or road.
    //    Both are queried using the chain's real geometry, and the closest
    //    by geometry-to-geometry distance wins.
    if (!chainName) {
      const candidates: any[] = [];
      try {
        const nearParkQ = `[out:json][timeout:15];
way(id:${chainWayIds})->.chain;
(way["leisure"="park"]["name"](around.chain:500);
relation["leisure"="park"]["name"](around.chain:500);
way["natural"="wood"]["name"](around.chain:500);
relation["natural"="wood"]["name"](around.chain:500););
out geom tags;`;
        const nearParkData = await ctx.queryOverpass(nearParkQ);
        candidates.push(...rankByGeomDistance(chainPts, nearParkData.elements));
      } catch {}
      try {
        const roadQ = `[out:json][timeout:15];
way(id:${chainWayIds})->.chain;
way["highway"~"^(primary|secondary|tertiary|residential)$"]["name"](around.chain:100);
out geom tags;`;
        const roadData = await ctx.queryOverpass(roadQ);
        candidates.push(...rankByGeomDistance(chainPts, roadData.elements));
      } catch {}
      candidates.sort((a: any, b: any) => a.dist - b.dist);
      if (candidates.length > 0) chainName = candidates[0].name;
    }

    if (!chainName) continue;

    const _ways = indices.map(i => unchainedWays[i].geometry);
    const anchors: [number, number][] = [];
    for (const i of indices) {
      const g = unchainedWays[i].geometry;
      anchors.push([g[0].lon, g[0].lat]);
      anchors.push([g[g.length - 1].lon, g[g.length - 1].lat]);
    }
    const tags = mergeWayTags(indices.map(i => unchainedWays[i]));

    osmNamedWays.push({
      name: chainName,
      wayCount: indices.length,
      tags,
      anchors,
      osmNames: [chainName],
      _ways,
      _wayIds: indices.map(i => unchainedWays[i].id).filter(Boolean),
      _isUnnamedChain: true,
    });
    unnamedChains.push(chainName);
  }
  if (unnamedChains.length > 0) {
    console.log(`  Found ${unnamedChains.length} unnamed chains >= ${MIN_CHAIN_LENGTH_M / 1000}km`);
  }
}

// ---------------------------------------------------------------------------
// Step 2d: Discover non-cycling route relations
// ---------------------------------------------------------------------------

async function discoverNonCycling(ctx: PipelineContext, osmRelations: OsmRelation[], osmNamedWays: NamedWayEntry[]): Promise<NonCyclingCandidate[]> {
  // Discover non-cycling route relations (hiking, skiing, etc.)
  // that share ways with our cycling infrastructure ("web spider").
  // Walk UP from cycling ways to find their parent non-cycling relations.
  // These are NOT entries — they become overlap metadata on existing entries.
  const nonCyclingCandidates: NonCyclingCandidate[] = [];
  const allCyclingWayIds = [
    ...osmRelations.flatMap(r => r._memberWayIds || []),
    ...osmNamedWays.flatMap(np => np._wayIds || []),
  ].filter(Boolean);

  if (allCyclingWayIds.length > 0) {
    console.log('Discovering non-cycling relations sharing cycling infrastructure...');
    const CHUNK_SIZE = 2000;
    const allNonCyclingRels = new Map<number, any>();
    for (let i = 0; i < allCyclingWayIds.length; i += CHUNK_SIZE) {
      const chunk = allCyclingWayIds.slice(i, i + CHUNK_SIZE);
      const spiderQ = `[out:json][timeout:120];\nway(id:${chunk.join(',')});\nrel(bw)["route"]["route"!="bicycle"]["route"!="mtb"]["route"!="bus"]["route"!="road"]["route"!="detour"]["route"!="ski"]["type"="route"];\nout tags;`;
      try {
        const spiderData = await ctx.queryOverpass(spiderQ);
        // Chunks are logged at debug level only
        for (const el of spiderData.elements) {
          if (!allNonCyclingRels.has(el.id)) allNonCyclingRels.set(el.id, el);
        }
      } catch (err: any) {
        console.error(`  Non-cycling relation discovery chunk failed: ${err.message}`);
      }
    }

    console.log(`  ${allNonCyclingRels.size} unique non-cycling relations found`);

    // rel(bw) returns relations without member lists. Fetch full body separately.
    if (allNonCyclingRels.size > 0) {
      const relIds = [...allNonCyclingRels.keys()];
      const bodyQ = `[out:json][timeout:120];\n(\n${relIds.map(id => `  relation(${id});`).join('\n')}\n);\nout body;`;
      try {
        const bodyData = await ctx.queryOverpass(bodyQ);
        for (const el of bodyData.elements) {
          if (el.members && allNonCyclingRels.has(el.id)) {
            allNonCyclingRels.get(el.id).members = el.members;
          }
        }
      } catch (err: any) {
        console.error(`  Failed to fetch non-cycling relation members: ${err.message}`);
      }
    }

    const cyclingWayIdSet = new Set(allCyclingWayIds);
    for (const [relId, el] of allNonCyclingRels) {
      const memberWayIds = (el.members || []).filter((m: any) => m.type === 'way').map((m: any) => m.ref);
      const bikeableWayIds = memberWayIds.filter((id: number) => cyclingWayIdSet.has(id));
      if (bikeableWayIds.length === 0) continue;
      if (!el.tags?.name) continue; // skip unnamed relations — no display value
      const bikeablePct = bikeableWayIds.length / memberWayIds.length;
      nonCyclingCandidates.push({
        id: relId,
        name: el.tags.name,
        route: el.tags?.route || 'unknown',
        operator: el.tags?.operator,
        ref: el.tags?.ref,
        network: el.tags?.network,
        wikipedia: el.tags?.wikipedia,
        website: el.tags?.website || el.tags?.['contact:website'],
        bikeableWayIds,
        bikeablePct,
      });
    }
    if (nonCyclingCandidates.length > 0) {
      console.log(`  Found ${nonCyclingCandidates.length} non-cycling relations sharing cycling ways`);
    }
  }

  return nonCyclingCandidates;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function discover(ctx: PipelineContext, wayRegistry: WayRegistry): Promise<DiscoveredData> {
  const { osmRelations, relationBaseNames } = await discoverRelations(ctx, wayRegistry);
  const osmNamedWays = await discoverNamedWays(ctx, osmRelations, wayRegistry);
  const parallelLanes = await discoverParallelLanes(ctx);
  await discoverUnnamedChains(ctx, osmNamedWays, osmRelations);
  const nonCyclingCandidates = await discoverNonCycling(ctx, osmRelations, osmNamedWays);
  return { osmRelations, osmNamedWays, parallelLanes, nonCyclingCandidates, relationBaseNames };
}
