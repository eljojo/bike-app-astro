// scripts/pipeline/phases/discover-non-cycling.ts
//
// Phase 5: discover non-cycling route relations (hiking, ski, piste,
// foot, etc.) that share member ways with cycling infrastructure. These
// are NOT promoted as entries — they become overlap metadata on the
// cycling entries that share their ways.
//
// Depends on discover.relations and discover.namedWays for the full set
// of cycling way IDs. Spider chunks fan out in parallel.
//
// Pure async function: (input, ctx) => NonCyclingCandidate[].

import type { OsmRelation, NamedWayEntry, NonCyclingCandidate } from '../lib/pipeline-types.ts';
import type { Phase } from './_phase-types.ts';

interface Inputs {
  relations: OsmRelation[];
  namedWays: NamedWayEntry[];
}

const CHUNK_SIZE = 2000;

export const discoverNonCyclingPhase: Phase<Inputs, NonCyclingCandidate[]> = async ({ relations, namedWays, ctx }) => {
  const nonCyclingCandidates: NonCyclingCandidate[] = [];
  const allCyclingWayIds = [
    ...relations.flatMap((r) => r._memberWayIds || []),
    ...namedWays.flatMap((np) => np._wayIds || []),
  ].filter(Boolean);

  if (allCyclingWayIds.length === 0) return nonCyclingCandidates;

  console.log('Discovering non-cycling relations sharing cycling infrastructure...');

  // Chunk the way IDs and fan out spider queries in parallel
  const chunks: number[][] = [];
  for (let i = 0; i < allCyclingWayIds.length; i += CHUNK_SIZE) {
    chunks.push(allCyclingWayIds.slice(i, i + CHUNK_SIZE));
  }

  const spiderResults = await Promise.all(chunks.map(async (chunk) => {
    const spiderQ = `[out:json][timeout:120];\nway(id:${chunk.join(',')});\nrel(bw)["route"]["route"!="bicycle"]["route"!="mtb"]["route"!="bus"]["route"!="road"]["route"!="detour"]["route"!="ski"]["type"="route"];\nout tags;`;
    try {
      const spiderData = await ctx.queryOverpass(spiderQ);
      return spiderData.elements;
    } catch (err: any) {
      console.error(`  Non-cycling relation discovery chunk failed: ${err.message}`);
      return [];
    }
  }));

  const allNonCyclingRels = new Map<number, any>();
  for (const els of spiderResults) {
    for (const el of els) {
      if (!allNonCyclingRels.has(el.id)) allNonCyclingRels.set(el.id, el);
    }
  }

  console.log(`  ${allNonCyclingRels.size} unique non-cycling relations found`);

  if (allNonCyclingRels.size === 0) return nonCyclingCandidates;

  // rel(bw) returns relations without member lists. Fetch full body separately.
  const relIds = [...allNonCyclingRels.keys()];
  const bodyQ = `[out:json][timeout:120];\n(\n${relIds.map((id) => `  relation(${id});`).join('\n')}\n);\nout body;`;
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

  const cyclingWayIdSet = new Set(allCyclingWayIds);
  for (const [relId, el] of allNonCyclingRels) {
    const memberWayIds = (el.members || []).filter((m: any) => m.type === 'way').map((m: any) => m.ref);
    const bikeableWayIds = memberWayIds.filter((id: number) => cyclingWayIdSet.has(id));
    if (bikeableWayIds.length === 0) continue;
    if (!el.tags?.name) continue; // skip unnamed relations — no display value
    const bikeablePct = bikeableWayIds.length / memberWayIds.length;

    ctx.trace(`relation:${relId}`, 'discovered', {
      route: el.tags?.route,
      name: el.tags?.name,
      bikeablePct,
    });

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

  return nonCyclingCandidates;
};
