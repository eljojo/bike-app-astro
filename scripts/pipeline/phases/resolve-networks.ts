// scripts/pipeline/phases/resolve-networks.ts
//
// Phase 8: super-network resolution. Discovers OSM superroutes and
// route-system networks (cycle_network tag), promotes qualifying
// sub-superroutes to real network entries, and assigns members via
// addSuperrouteNetworks.
//
// Pure async function: (input, ctx) => { entries, superNetworks }.
//
// Bug cluster: hierarchy inversion (commit 55372425), networks absorbing
// children's relation IDs (commit 20386086).

import type { DiscoveredData } from '../lib/pipeline-types.ts';
import type { Phase } from './_phase-types.ts';
import type { WayRegistry } from '../lib/way-registry.mjs';
import { discoverNetworks, discoverRouteSystemNetworks } from '../lib/discover-networks.mjs';
import { isLongDistance } from '../lib/entry-type.mjs';
import { applyMtbSplits } from '../lib/split-mtb-networks.ts';
import { suppressEmptyWrappers } from '../lib/suppress-empty-wrappers.ts';

interface Inputs {
  entries: any[];
  discovered: DiscoveredData;
  wayRegistry: WayRegistry;
}

interface Output {
  entries: any[];
  superNetworks: any[];
}

// ---------------------------------------------------------------------------
// addSuperrouteNetworks — private helper, ported verbatim from lib/resolve.ts
// ---------------------------------------------------------------------------
//
// Apply OSM superroute data as super_network attributes on entries.
// Super-networks (Capital Pathway, TCT) are NOT pages -- they're metadata
// that shows in the facts table and influences index grouping.
// The real networks come from auto-grouping (type: network).
// Turn OSM superroutes into real type: network entries.
// Members that are already in an auto-group network stay there --
// the auto-group network gets a super_network attribute for index grouping.
// Only orphaned paths (not in any network) become direct members.
function addSuperrouteNetworks(entries: any[], networks: any[], wayRegistry: WayRegistry) {
  const byRelation = new Map();
  for (const entry of entries) {
    for (const relId of entry.osm_relations ?? []) {
      byRelation.set(relId, entry);
    }
  }

  // Snapshot: entries in park-based networks should not be reassigned.
  // Park containment is the strongest signal. Auto-group networks CAN be
  // flattened into superroute networks.
  const parkNetworks = new Set();
  for (const entry of entries) {
    if (entry.type === 'network' && entry._parkName) parkNetworks.add(entry);
  }
  const parkMembers = new Set();
  for (const entry of entries) {
    if (entry._networkRef && parkNetworks.has(entry._networkRef)) {
      parkMembers.add(entry);
    }
  }

  const superNetworkMeta: any[] = [];

  // Sort networks least-specific-first so the most specific (local)
  // network processes last and wins super_network assignment.
  // ncn (national) < rcn (regional) < lcn (local) < unknown.
  // Capital Pathway (rcn) should beat Trans Canada Trail (ncn).
  const NET_PRIORITY: Record<string, number> = { ncn: 0, rcn: 1, lcn: 2 };
  const sortedNetworks = [...networks]
    .filter((n: any) => !n._promoted)
    .sort((a: any, b: any) => {
      const pa = NET_PRIORITY[a.network] ?? 3;
      const pb = NET_PRIORITY[b.network] ?? 3;
      return pa - pb;
    });

  for (const network of sortedNetworks) {
    const name = network.name;

    // Create network entry shell -- _memberRefs populated below
    const networkEntry: any = {
      name,
      type: 'network',
      _memberRefs: [],
      osm_relations: network.osm_relations,
    };
    if (network.name_fr) networkEntry.name_fr = network.name_fr;
    if (network.name_en) networkEntry.name_en = network.name_en;
    if (network.operator) networkEntry.operator = network.operator;
    if (network.network) networkEntry.network = network.network;
    if (network.wikidata) networkEntry.wikidata = network.wikidata;
    if (network.wikipedia) networkEntry.wikipedia = network.wikipedia;
    if (network.cycle_network) networkEntry.cycle_network = network.cycle_network;

    // Resolve members: assign paths to this network.
    // A path can belong to multiple networks (e.g. Watts Creek is in both
    // NCC Greenbelt and Capital Pathway). member_of (from _networkRef) is
    // the PRIMARY network (determines URL). But the path also appears in
    // secondary networks' members arrays for display on those pages.
    // If a relation maps to a type: network entry (e.g. Rideau Canal Western
    // became an auto-group), flatten through its non-network members.
    // Also tag existing networks with _superNetworkRef for index grouping.
    for (const relId of network._member_relations || []) {
      const member = byRelation.get(relId);
      if (!member) continue;

      // Long-distance paths are significant rides people plan trips for.
      // They get their own top-level pages, never subordinated under a network.
      if (isLongDistance(member)) continue;

      if (member.type === 'network') {
        // Park networks are NOT intermediaries -- don't flatten them.
        // Their members stay primary to the park. Just add them as
        // secondary members of this superroute network.
        if (parkNetworks.has(member)) {
          member._superNetworkRef = networkEntry;
          for (const sub of (member._memberRefs || [])) {
            if (sub.type === 'network') continue;
            if (!networkEntry._memberRefs.includes(sub)) {
              networkEntry._memberRefs.push(sub);
            }
          }
          continue;
        }
        // Flatten: adopt its _memberRefs into this superroute network.
        // Only auto-group networks get flattened -- they're intermediaries.
        // byRelation was built at function start, so networks created by
        // earlier iterations of THIS loop won't be in it. Cross-call
        // flattening is prevented by combining all networks into one call.
        for (const sub of [...(member._memberRefs || [])]) {
          if (sub.type === 'network') continue;
          if (sub._networkRef === member || !sub._networkRef) {
            networkEntry._memberRefs.push(sub);
            sub._networkRef = networkEntry;
            if (member._memberRefs) {
              member._memberRefs = member._memberRefs.filter((m: any) => m !== sub);
            }
          } else if (!networkEntry._memberRefs.includes(sub)) {
            // Already in another network -- add as secondary member
            // (appears in members array, but member_of stays as-is)
            networkEntry._memberRefs.push(sub);
          }
        }
        // Tag the sub-network with _superNetworkRef (most specific wins --
        // networks are sorted largest-first so smaller overwrites larger)
        member._superNetworkRef = networkEntry;
        // Clean up the flattened auto-group network's way claims
        if (wayRegistry) wayRegistry.remove(member);
        continue;
      }

      if (member._networkRef) {
        const existingNet = member._networkRef;

        // If the member is in a non-park auto-group (no osm_relations),
        // flatten the auto-group into this superroute network.
        if (!parkNetworks.has(existingNet) && !existingNet.osm_relations?.length) {
          for (const sub of [...(existingNet._memberRefs || [])]) {
            if (sub.type === 'network') continue;
            if (sub._networkRef === existingNet || !sub._networkRef) {
              networkEntry._memberRefs.push(sub);
              sub._networkRef = networkEntry;
              if (existingNet._memberRefs) {
                existingNet._memberRefs = existingNet._memberRefs.filter((m: any) => m !== sub);
              }
            } else if (!networkEntry._memberRefs.includes(sub)) {
              networkEntry._memberRefs.push(sub);
            }
          }
          existingNet._superNetworkRef = networkEntry;
          if (wayRegistry) wayRegistry.remove(existingNet);
          continue;
        }

        // Already in a park or superroute network -- add as secondary member.
        // Only set _superNetworkRef if this network has wider scope.
        const existingPriority = NET_PRIORITY[existingNet.network] ?? 3;
        const currentPriority = NET_PRIORITY[networkEntry.network] ?? 3;
        if (currentPriority < existingPriority) {
          existingNet._superNetworkRef = networkEntry;
        }
        member._superNetworkRef = networkEntry;
        if (!networkEntry._memberRefs.includes(member)) {
          networkEntry._memberRefs.push(member);
        }
        continue;
      }

      // Park members keep their primary network but join this one too
      if (parkMembers.has(member)) {
        member._superNetworkRef = networkEntry;
        if (!networkEntry._memberRefs.includes(member)) {
          networkEntry._memberRefs.push(member);
        }
        continue;
      }
      networkEntry._memberRefs.push(member);
      member._networkRef = networkEntry;
    }

    // Fallback: adopt orphaned paths with matching operator.
    // Catches paths like Pinecrest Creek (NCC, cycleway) that aren't in
    // the OSM superroute member list but clearly belong to the system.
    if (network.operator) {
      for (const entry of entries) {
        if (entry._networkRef || entry.type === 'network') continue;
        // Operator must match (handles NCC variants)
        const op = entry.operator || '';
        const netOp = network.operator || '';
        if (!op || !netOp) continue;
        // Exact match (case-insensitive) or one is an abbreviation/subset of
        // the other, but require minimum 3 chars to avoid false matches like
        // "City" matching "City of Ottawa Parks"
        const opLower = op.toLowerCase();
        const netLower = netOp.toLowerCase();
        const match = opLower === netLower
          || (netLower.length >= 3 && opLower.includes(netLower))
          || (opLower.length >= 3 && netLower.includes(opLower));
        if (!match) continue;
        // Must be cycling infrastructure
        if (entry.highway !== 'cycleway' && entry.highway !== 'path') continue;
        if (!networkEntry._memberRefs.includes(entry)) {
          networkEntry._memberRefs.push(entry);
          entry._networkRef = networkEntry;
        }
      }
    }

    // Ref matching: orphaned entries sharing a `ref` tag with existing members
    // belong to the same route system. E.g., ref: GPW ties Greenbelt Pathway
    // West (Barrhaven) to the Greenbelt network. More specific than operator.
    const refTags = new Set();
    for (const memberEntry of networkEntry._memberRefs) {
      if (memberEntry.ref) refTags.add(memberEntry.ref);
    }
    if (refTags.size > 0) {
      for (const entry of entries) {
        if (entry._networkRef || entry.type === 'network') continue;
        if (parkMembers.has(entry)) continue;
        if (!entry.ref || !refTags.has(entry.ref)) continue;
        // Exclude roads -- they have ref tags (route numbers) that would
        // cause false matches. Allow entries without highway (relation-only).
        const roadHw = ['primary', 'secondary', 'tertiary', 'residential', 'unclassified'];
        if (entry.highway && roadHw.includes(entry.highway)) continue;
        if (!networkEntry._memberRefs.includes(entry)) {
          networkEntry._memberRefs.push(entry);
          entry._networkRef = networkEntry;
          console.log(`    ref match: ${entry.name} (ref: ${entry.ref}) -> ${name}`);
        }
      }
    }

    if (networkEntry._memberRefs.length === 0) {
      console.log(`  Skipping superroute network "${name}": no orphaned members`);
      continue;
    }

    entries.push(networkEntry);
    console.log(`  Superroute network: ${name} (${networkEntry._memberRefs.length} members)`);

    // Store metadata for YAML output (slug resolved in final pass)
    const meta: any = { name, _entryRef: networkEntry };
    if (network.wikidata) meta.wikidata = network.wikidata;
    if (network.operator) meta.operator = network.operator;
    if (network.name_fr) meta.name_fr = network.name_fr;
    if (network.wikidata_meta) meta.wikidata_meta = network.wikidata_meta;
    superNetworkMeta.push(meta);
  }

  return superNetworkMeta;
}

// ---------------------------------------------------------------------------
// resolveNetworksPhase — public phase entry point
// ---------------------------------------------------------------------------

export const resolveNetworksPhase: Phase<Inputs, Output> = async ({ entries, wayRegistry, ctx }) => {
  const grouped = [...entries];

  let superNetworks: any[] = [];
  let allNetSources: any[] = [];

  if (ctx.adapter.discoverNetworks) {
    console.log('Discovering super-networks (OSM superroutes)...');
    const networks = await discoverNetworks({ bbox: ctx.bbox, queryOverpass: ctx.queryOverpass });
    if (networks.length > 0) {
      // Promoted sub-superroutes (like Ottawa River Pathway) become real
      // network entries with members. Top-level superroutes become attributes.
      const promoted = networks.filter((n: any) => n._promoted);
      allNetSources.push(...networks.filter((n: any) => !n._promoted));

      // Add promoted networks as type: network entries
      for (const net of promoted as any[]) {
        const byRelation = new Map();
        for (const entry of grouped) {
          for (const relId of entry.osm_relations ?? []) byRelation.set(relId, entry);
        }
        const memberRefs: any[] = [];
        for (const relId of net._member_relations || []) {
          const member = byRelation.get(relId);
          if (member && member.type !== 'network') {
            // Remove from old network's _memberRefs if reassigning
            if (member._networkRef && member._networkRef._memberRefs) {
              member._networkRef._memberRefs = member._networkRef._memberRefs.filter((m: any) => m !== member);
            }
            memberRefs.push(member);
          }
        }
        // Absorb same-named entries and merge same-named auto-group networks.
        // Standalone fragments get _networkRef. Auto-group networks with the
        // same base name (e.g. "Ottawa River Pathway Network") get their
        // _memberRefs transferred and the auto-group network is emptied.
        const netNameLower = net.name.toLowerCase();

        // First: merge any auto-group network with the same base name
        for (const entry of grouped) {
          if (entry.type !== 'network') continue;
          if (entry === net) continue;
          const entryNameLower = entry.name?.toLowerCase().replace(/ (trails|network)$/i, '');
          if (entryNameLower !== netNameLower) continue;
          // Transfer _memberRefs from auto-group network to promoted network
          for (const sub of entry._memberRefs || []) {
            if (!memberRefs.includes(sub)) {
              memberRefs.push(sub);
            }
          }
          entry._memberRefs = []; // will be cleaned up as zombie
          // Clean up the emptied auto-group network's way claims
          if (wayRegistry) wayRegistry.remove(entry);
        }

        // Then: absorb orphaned same-named entries
        for (const entry of grouped) {
          if (entry.type === 'network') continue;
          if (entry._networkRef) continue;
          if (entry.name?.toLowerCase() !== netNameLower) continue;
          if (!memberRefs.includes(entry)) {
            memberRefs.push(entry);
          }
        }

        if (memberRefs.length >= 2) {
          const networkEntry: any = {
            name: net.name,
            type: 'network',
            _memberRefs: memberRefs,
            osm_relations: net.osm_relations,
          };
          if (net.name_fr) networkEntry.name_fr = net.name_fr;
          if (net.operator) networkEntry.operator = net.operator;
          if (net.wikidata) networkEntry.wikidata = net.wikidata;
          if (net.wikipedia) networkEntry.wikipedia = net.wikipedia;
          grouped.push(networkEntry);
          // Assign _networkRef on all members
          for (const m of memberRefs) {
            m._networkRef = networkEntry;
          }
          console.log(`  Added promoted network: ${net.name} (${memberRefs.length} members)`);
        }
        delete net._promoted;
        delete net._member_relations;
      }

    }

    // Discover route-system networks (e.g. Crosstown Bikeways from cycle_network tags)
    const routeSystemNets = await discoverRouteSystemNetworks({ bbox: ctx.bbox, queryOverpass: ctx.queryOverpass });
    if (routeSystemNets.length > 0) {
      allNetSources.push(...routeSystemNets);
    }

    // Merge superroute members into route-system networks when they share
    // a cycle_network tag. A superroute like CB2 (cycle_network: CA:ON:Ottawa)
    // is redundant when Ottawa Bikeways already groups by that tag. Merging
    // ensures members like Laurier (which lack their own cycle_network tag)
    // get included in Ottawa Bikeways via the superroute's membership.
    const routeSystemByCN = new Map();
    for (const net of allNetSources) {
      if (net.cycle_network && !net.osm_relations) {
        routeSystemByCN.set(net.cycle_network, net);
      }
    }
    allNetSources = allNetSources.filter((net: any) => {
      if (!net.osm_relations || !net.cycle_network) return true;
      const rsNet = routeSystemByCN.get(net.cycle_network);
      if (!rsNet) return true;
      const existing = new Set(rsNet._member_relations);
      for (const relId of net._member_relations || []) {
        if (!existing.has(relId)) {
          rsNet._member_relations.push(relId);
        }
      }
      console.log(`  Merged superroute "${net.name}" into route-system "${rsNet.name}"`);
      return false;
    });

    // Create all superroute + route-system networks in one call so byRelation
    // is built once. This prevents the second batch from flattening the first.
    if (allNetSources.length > 0) {
      console.log('Creating superroute & route-system networks...');
      superNetworks = addSuperrouteNetworks(grouped, allNetSources, wayRegistry);
    }
  }

  // Rule 6 (Stage 2): drop empty "<Name> Trails" wrappers when a
  // non-network <Name> path entry exists. Auto-group synthesizes these
  // wrappers and they clutter the MTB tab with zero-content networks.
  const deWrapped = suppressEmptyWrappers(grouped);

  // Rule 7 (Stage 1.5): split networks that mix MTB-trail and non-MTB
  // members into <original> + <original> MTB. Fixes the category error
  // where the NCC Greenbelt lands in the MTB tab because its MTB members
  // outnumber pathway ones. See scripts/pipeline/lib/split-mtb-networks.ts.
  const split = applyMtbSplits(deWrapped);

  // Trace events at the decision-point boundary: one per network that now
  // has _memberRefs (both promoted auto-group networks and superroute networks).
  for (const e of split) {
    if (e.type === 'network' && e._memberRefs) {
      ctx.trace(`entry:${e.name}`, 'created', {
        kind: 'superroute-network',
        memberCount: e._memberRefs.length,
      });
    }
  }

  return { entries: split, superNetworks };
};
