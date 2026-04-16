// scripts/pipeline/lib/split-mtb-networks.ts
//
// Rule 7 (Stage 1.5): when a network contains both MTB-trail members and
// non-MTB members, split it into two networks — one for each character.
// Fixes the "NCC Greenbelt lands in MTB tab because its MTB members
// outnumber pathway members" category error.
//
// Pure function — no I/O, no side effects beyond constructing the new
// network entries and moving member references. The sibling relationship
// is encoded via a private `_mtb_split_sibling` marker pointing at the
// other entry; a later phase (finalize-resolve) converts it to the
// schema-level `related: [<sibling-slug>]`.
//
// Callers in the pipeline pass all network entries through this split
// before slug assignment. See scripts/pipeline/phases/resolve-networks.ts.

/** Minimum total member count for a network to be eligible for splitting.
 *  Below this threshold, splitting adds complexity without IA benefit. */
export const MIN_MEMBERS_FOR_SPLIT = 3;

/** Minimal shape this function cares about. Full entries have many other
 *  fields; those pass through unchanged via spread. */
export interface NetworkEntryLike {
  name: string;
  type: string;
  path_type?: string;
  _memberRefs?: NetworkEntryLike[];
  // Any other pipeline-internal fields ride along via spread.
  [k: string]: unknown;
}

/**
 * If the network's members mix MTB-trail and non-MTB characters AND the
 * total member count meets the threshold, return two networks — one with
 * the non-MTB members, one with the MTB members. Otherwise return the
 * input unchanged as a single-element array.
 *
 * The MTB half's name is `<original> MTB`. At the finalize-resolve phase
 * the slug is derived from this name; subsequent overlays can customize
 * the display name further via markdown.
 *
 * Each returned entry carries `_mtb_split_sibling` pointing at the other.
 * The marker is private to the pipeline — downstream phases resolve it to
 * `related: [<sibling-slug>]` in bikepaths.yml.
 */
export function splitMixedCharacterNetwork<T extends NetworkEntryLike>(network: T): T[] {
  if (network.type !== 'network') return [network];
  const members = network._memberRefs ?? [];
  if (members.length < MIN_MEMBERS_FOR_SPLIT) return [network];

  const mtbMembers = members.filter((m) => m.path_type === 'mtb-trail');
  const nonMtbMembers = members.filter((m) => m.path_type !== 'mtb-trail');

  // Need at least one on each side to warrant a split.
  if (mtbMembers.length === 0 || nonMtbMembers.length === 0) return [network];

  // Build both halves. Preserve all pipeline-internal fields on the
  // pathway half; the MTB half gets a derived name and the MTB members.
  const pathwayHalf: T = {
    ...network,
    _memberRefs: nonMtbMembers,
  };
  const mtbHalf: T = {
    ...network,
    name: `${network.name} MTB`,
    _memberRefs: mtbMembers,
    // Don't carry the original's osm_relations into the MTB half —
    // the OSM relation (if any) describes the whole network, not the
    // MTB subset. Downstream phases treat relation-less networks as
    // pipeline-synthesized.
    osm_relations: undefined,
  };

  // Cross-reference via the private marker. Finalize-resolve converts
  // this to `related: [<sibling-slug>]` once slugs are assigned.
  (pathwayHalf as unknown as { _mtb_split_sibling: T })._mtb_split_sibling = mtbHalf;
  (mtbHalf as unknown as { _mtb_split_sibling: T })._mtb_split_sibling = pathwayHalf;

  // Update each moved member's _networkRef to point at its new owner.
  for (const m of nonMtbMembers) (m as { _networkRef?: T })._networkRef = pathwayHalf;
  for (const m of mtbMembers) (m as { _networkRef?: T })._networkRef = mtbHalf;

  return [pathwayHalf, mtbHalf];
}

/** Apply the split to every network in the grouped entry list. Members
 *  stay as-is (they're referenced by the new _memberRefs). Returns the
 *  new full entries array with replaced networks. */
export function applyMtbSplits<T extends NetworkEntryLike>(entries: T[]): T[] {
  const out: T[] = [];
  for (const e of entries) {
    if (e.type !== 'network') { out.push(e); continue; }
    const split = splitMixedCharacterNetwork(e);
    out.push(...split);
  }
  return out;
}
