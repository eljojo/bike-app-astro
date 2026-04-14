// scripts/pipeline/phases/discover-unnamed-chains.ts
//
// Phase 4: discover unnamed cycling chains — groups of unnamed path/
// cycleway ways >= 1.5km that connect via shared endpoints. Each chain
// is named from the closest/containing named feature (park or road).
//
// Per-chain naming queries fan out in parallel. Within a chain, the
// is_in containment check early-exits (first park wins), but the
// nearPark and road fallback queries run as Promise.all. Semantic
// ordering is preserved: containment > geometry-to-geometry distance.
//
// Pure async function: (input, ctx) => NamedWayEntry[] (list of new
// chains, NOT mutating any shared state).

import type { NamedWayEntry } from '../lib/pipeline-types.ts';
import type { Phase } from './_phase-types.ts';
import { mergeWayTags } from '../lib/osm-tags.ts';
import { rankByGeomDistance } from '../lib/nearest-park.mjs';
import { slugifyBikePathName as slugify } from '../../../src/lib/bike-paths/bikepaths-yml.server.ts';

const MIN_CHAIN_LENGTH_M = 1500;

function wayLength(g: any[]) {
  let len = 0;
  for (let i = 1; i < g.length; i++) {
    const dlat = (g[i].lat - g[i - 1].lat) * 111320;
    const dlng = (g[i].lon - g[i - 1].lon) * 111320 * Math.cos(g[i].lat * Math.PI / 180);
    len += Math.sqrt(dlat * dlat + dlng * dlng);
  }
  return len;
}

export const discoverUnnamedChainsPhase: Phase<{}, NamedWayEntry[]> = async ({ ctx }) => {
  console.log('Discovering unnamed cycling chains...');
  const unchainedQ = `[out:json][timeout:120];
way["highway"~"cycleway|path"]["bicycle"~"designated|yes"][!"name"][!"crossing"](${ctx.bbox});
out geom tags;`;
  const unchainedData = await ctx.queryOverpass(unchainedQ);
  const unchainedWays = unchainedData.elements.filter((w: any) => w.geometry?.length >= 2);

  // Trace each discovered way
  for (const w of unchainedWays) {
    if (w.id) ctx.trace(`way:${w.id}`, 'discovered', { via: 'unnamed-chain-query' });
  }

  // Build union-find index of endpoints
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
  function ucFind(x: number) {
    while (ucParent[x] !== x) { ucParent[x] = ucParent[ucParent[x]]; x = ucParent[x]; }
    return x;
  }
  for (const [, indices] of ucEpIndex) {
    for (let i = 1; i < indices.length; i++) {
      const ra = ucFind(indices[0]), rb = ucFind(indices[i]);
      if (ra !== rb) ucParent[ra] = rb;
    }
  }

  // Group ways by union-find root
  const ucGroups = new Map<number, number[]>();
  for (let i = 0; i < unchainedWays.length; i++) {
    const root = ucFind(i);
    if (!ucGroups.has(root)) ucGroups.set(root, []);
    ucGroups.get(root)!.push(i);
  }

  // Per-chain naming runs in parallel. Inside each chain, the is_in
  // containment check early-exits (semantic requirement — first match
  // wins). The nearPark + road fallback queries within a chain DO run
  // as Promise.all.
  const newChains = await Promise.all(Array.from(ucGroups.values()).map(async (indices) => {
    // Skip chains under the length threshold
    let totalLen = 0;
    for (const i of indices) totalLen += wayLength(unchainedWays[i].geometry);
    if (totalLen < MIN_CHAIN_LENGTH_M) return null;

    const chainWayIds = indices.map(i => unchainedWays[i].id).join(',');
    const chainPts = indices.flatMap(i => unchainedWays[i].geometry);

    let chainName: string | null = null;
    let nameSource: 'is-in' | 'nearPark' | 'road' | null = null;

    // 1. Is-in containment check — sample 3 points along the chain.
    //    Sequential within a chain: early exit on first hit.
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
            chainName = isInData.elements[0].tags?.name || null;
            if (chainName) nameSource = 'is-in';
          }
        } catch {}
      }
    } catch {}

    // 2. If no containment, find closest named feature (park or road).
    //    Queries fire as Promise.all within this chain.
    if (!chainName) {
      const nearParkQ = `[out:json][timeout:15];
way(id:${chainWayIds})->.chain;
(way["leisure"="park"]["name"](around.chain:500);
relation["leisure"="park"]["name"](around.chain:500);
way["natural"="wood"]["name"](around.chain:500);
relation["natural"="wood"]["name"](around.chain:500););
out geom tags;`;
      const roadQ = `[out:json][timeout:15];
way(id:${chainWayIds})->.chain;
way["highway"~"^(primary|secondary|tertiary|residential)$"]["name"](around.chain:100);
out geom tags;`;

      const [nearParkData, roadData] = await Promise.all([
        ctx.queryOverpass(nearParkQ).catch(() => ({ elements: [] })),
        ctx.queryOverpass(roadQ).catch(() => ({ elements: [] })),
      ]);

      const candidates: any[] = [];
      candidates.push(...rankByGeomDistance(chainPts, nearParkData.elements).map((c: any) => ({ ...c, source: 'nearPark' })));
      candidates.push(...rankByGeomDistance(chainPts, roadData.elements).map((c: any) => ({ ...c, source: 'road' })));
      candidates.sort((a: any, b: any) => a.dist - b.dist);
      if (candidates.length > 0) {
        chainName = candidates[0].name;
        nameSource = candidates[0].source;
      }
    }

    if (!chainName) return null;

    const _ways = indices.map(i => unchainedWays[i].geometry);
    const anchors: [number, number][] = [];
    for (const i of indices) {
      const g = unchainedWays[i].geometry;
      anchors.push([g[0].lon, g[0].lat]);
      anchors.push([g[g.length - 1].lon, g[g.length - 1].lat]);
    }
    const tags = mergeWayTags(indices.map(i => unchainedWays[i]));

    const chainEntry: NamedWayEntry = {
      name: chainName,
      wayCount: indices.length,
      tags,
      anchors,
      osmNames: [chainName],
      _ways,
      _wayIds: indices.map(i => unchainedWays[i].id).filter(Boolean),
      _isUnnamedChain: true,
    };

    // Trace the named chain
    ctx.trace(`entry:${slugify(chainName)}`, 'discovered', {
      source: nameSource,
      ways: chainEntry._wayIds,
    });

    return chainEntry;
  }));

  const unnamedChains = newChains.filter((c): c is NamedWayEntry => c !== null);
  if (unnamedChains.length > 0) {
    console.log(`  Found ${unnamedChains.length} unnamed chains >= ${MIN_CHAIN_LENGTH_M / 1000}km`);
  }
  return unnamedChains;
};
