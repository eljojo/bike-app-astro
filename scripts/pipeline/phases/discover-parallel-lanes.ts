// scripts/pipeline/phases/discover-parallel-lanes.ts
//
// Phase 3: discover unnamed parallel bike lanes (highway=cycleway without
// a name, chained by midpoint proximity, matched to a parallel road via
// Overpass around:30 queries fanned out in parallel).
//
// Pure async function: (input, ctx) => ParallelLaneCandidate[]

import type { ParallelLaneCandidate } from '../lib/pipeline-types.ts';
import type { Phase } from './_phase-types.ts';
import { mergeWayTags } from '../lib/osm-tags.ts';
import { haversineM } from '../lib/geo.mjs';
import { chainSegments } from '../lib/chain-segments.mjs';
import { selectBestRoad } from '../lib/select-best-road.mjs';
import { defaultParallelLaneFilter } from '../lib/city-adapter.mjs';

// Group chains with the same road name only if their bboxes are within
// proximityM of each other. Same road name far apart = separate entries.
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

  return groups.map(g => {
    // Collect every segment's OSM way ID across every chain in the group so
    // the resulting candidate carries full way-level provenance. Without
    // this, parallel-lane entries never enter the WayRegistry and
    // structural ghost-removal can't see their overlap with relations.
    const wayIds: number[] = [];
    for (const chain of g.chains) {
      for (const id of chain.segmentIds ?? []) {
        if (typeof id === 'number') wayIds.push(id);
      }
    }
    return {
      name: g.roadName,
      parallel_to: g.roadName,
      anchors: [
        [g.bbox.west, g.bbox.south],
        [g.bbox.east, g.bbox.north],
      ] as [number, number][],
      tags: mergeWayTags(g.allTags.map((t: any, i: number) => ({ tags: t, id: i }))),
      _wayIds: wayIds.length > 0 ? [...new Set(wayIds)] : undefined,
    };
  });
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

export const discoverParallelLanesPhase: Phase<{}, ParallelLaneCandidate[]> = async ({ ctx }) => {
  console.log('Discovering unnamed parallel bike lanes...');
  const filter = ctx.adapter.parallelLaneFilter || defaultParallelLaneFilter;
  const plQ = `[out:json][timeout:120];
way["highway"="cycleway"][!"name"][!"crossing"](${ctx.bbox});
out tags center;`;
  const plData = await ctx.queryOverpass(plQ);
  const plCandidates = plData.elements.filter((el: any) => filter(el.tags || {}));

  // Trace each candidate segment as discovered
  for (const seg of plCandidates) {
    if (seg.id) ctx.trace(`way:${seg.id}`, 'discovered', { via: 'parallel-lane-query' });
  }

  if (plCandidates.length === 0) return [];

  const segments = plCandidates.map((el: any) => ({ id: el.id, center: el.center, tags: el.tags || {} }));
  const chains = chainSegments(segments, 50);

  // Fan out per-chain road lookups in parallel (runner semaphore bounds them)
  const chainResults = await Promise.all(chains.map(async (chain: any) => {
    const { lat, lon } = chain.midpoint;
    const roadQ = `[out:json][timeout:15];
way["highway"~"^(primary|secondary|tertiary|residential|unclassified)$"]["name"]
  (around:30,${lat},${lon});
out tags center;`;
    try {
      const roadData = await ctx.queryOverpass(roadQ);
      if (roadData.elements.length === 0) return null;
      const best = selectBestRoad(roadData.elements, { lat, lon });
      if (!best) return null;
      // Trace the pair: each segment is paired with the matched road
      for (const segId of chain.segmentIds || []) {
        ctx.trace(`way:${segId}`, 'paired', { roadName: best.name });
      }
      return {
        roadName: best.name,
        chain,
        tags: mergeWayTags(chain.tags.map((t: any, i: number) => ({ tags: t, id: chain.segmentIds[i] }))),
      };
    } catch {
      return null;
    }
  }));

  const validResults = chainResults.filter(Boolean) as any[];
  const parallelLanes = groupByRoadAndProximity(validResults, 500);
  console.log(`  ${parallelLanes.length} parallel lane candidates`);
  return parallelLanes;
};
