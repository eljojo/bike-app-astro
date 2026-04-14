// scripts/pipeline/phases/group-cluster.ts
//
// Phase 7: auto-group nearby trail segments into networks via
// connectivity clustering + park containment. Wraps
// autoGroupNearbyPaths from lib/auto-group.mjs and adds trace events
// at the cluster/membership decision points.
//
// Pure async function: (input, ctx) => entries[].

import type { Phase } from './_phase-types.ts';
import type { WayRegistry } from '../lib/way-registry.mjs';
import { autoGroupNearbyPaths } from '../lib/auto-group.ts';

interface Inputs {
  entries: any[];
  markdownSlugs: Set<string>;
  wayRegistry: WayRegistry;
}

export const groupClusterPhase: Phase<Inputs, any[]> = async ({ entries, markdownSlugs, wayRegistry, ctx }) => {
  const grouped: any[] = await autoGroupNearbyPaths({
    entries,
    markdownSlugs,
    queryOverpass: ctx.queryOverpass,
    bbox: ctx.bbox,
    wayRegistry,
  });

  // Trace cluster + member assignments at the decision-point boundaries.
  for (const e of grouped) {
    if (e.type === 'network') {
      ctx.trace(`entry:${e.name}`, 'created', { kind: 'network', memberCount: e._memberRefs?.length || 0 });
    }
    if (e._networkRef) {
      ctx.trace(`entry:${e.name}`, 'assigned', { network: e._networkRef.name });
    }
  }

  return grouped;
};
