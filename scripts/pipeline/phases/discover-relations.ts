// scripts/pipeline/phases/discover-relations.ts
//
// Phase 1: discover OSM cycling relations (route=bicycle|mtb), fetch
// their member way IDs, and aggregate way-level tags into the relation
// for downstream classification.
//
// Pure async function: (input, ctx) => OsmRelation[]. No shared state.

import type { OsmRelation } from '../lib/pipeline-types.ts';
import type { Phase } from './_phase-types.ts';
import { mergeWayTags } from '../lib/osm-tags.ts';

const CYCLING_ROUTES = new Set(['bicycle', 'mtb']);
const MEGA_MTB_THRESHOLD = 50;

export const discoverRelationsPhase: Phase<{}, OsmRelation[]> = async ({ ctx }) => {
  console.log('Discovering cycling relations from OSM...');

  // Step 1: discovery query
  const relQ = `[out:json][timeout:120];
(
  relation["route"="bicycle"](${ctx.bbox});
  relation["route"="mtb"](${ctx.bbox});
  relation["type"="route"]["name"~"${ctx.adapter.relationNamePattern}"](${ctx.bbox});
);
out tags;`;
  const relData = await ctx.queryOverpass(relQ);

  const osmRelations: OsmRelation[] = relData.elements
    .filter((el: any) => el.tags?.type !== 'superroute')
    .filter((el: any) => {
      const route = el.tags?.route;
      if (route && !CYCLING_ROUTES.has(route)) {
        console.log(`  Skipping non-cycling relation ${el.id} "${el.tags?.name}" (route=${route})`);
        ctx.trace(`relation:${el.id}`, 'filtered', {
          reason: 'non-cycling route tag',
          route,
          name: el.tags?.name,
        });
        return false;
      }
      return true;
    })
    .map((el: any) => {
      ctx.trace(`relation:${el.id}`, 'discovered', {
        name: el.tags?.name,
        route: el.tags?.route,
        network: el.tags?.network,
      });
      return {
        id: el.id,
        name: el.tags?.name || `relation-${el.id}`,
        tags: el.tags || {},
      } as OsmRelation;
    });

  console.log(`  Found ${osmRelations.length} cycling relations`);

  if (osmRelations.length === 0) return osmRelations;

  // Step 1a: fetch member way IDs (need `out body;` for member lists)
  const relIds = osmRelations.map((r) => r.id);
  const bodyQ = `[out:json][timeout:120];\n(\n${relIds.map((id) => `  relation(${id});`).join('\n')}\n);\nout body;`;
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

  // Filter out mega-MTB relations (entire trail systems aggregated as one relation)
  for (let i = osmRelations.length - 1; i >= 0; i--) {
    const r = osmRelations[i];
    if (r.tags?.route !== 'mtb') continue;
    if ((r._memberWayIds?.length || 0) <= MEGA_MTB_THRESHOLD) continue;
    if (r.tags?.network || r.tags?.ref) continue;
    console.log(`  Skipping mega-MTB relation ${r.id} "${r.name}" (${r._memberWayIds!.length} ways)`);
    ctx.trace(`relation:${r.id}`, 'filtered', {
      reason: 'mega-MTB aggregation',
      memberCount: r._memberWayIds!.length,
    });
    osmRelations.splice(i, 1);
  }

  // Step 1a-2: fetch way-level tags for relation members; aggregate via mergeWayTags
  const wayIdToRels = new Map<number, OsmRelation[]>();
  for (const rel of osmRelations) {
    for (const wid of rel._memberWayIds || []) {
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
          ctx.trace(`relation:${rel.id}`, 'enriched', {
            wayCount: ways.length,
            aggregatedTags: rel._aggregatedWayTags,
          });
        }
      }
      console.log(`  Aggregated way-level tags for ${enrichedCount} relations`);
    } catch (err: any) {
      console.error(`  Failed to fetch way-level tags: ${err.message}`);
    }
  }

  return osmRelations;
};
