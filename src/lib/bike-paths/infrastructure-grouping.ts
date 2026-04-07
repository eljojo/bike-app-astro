/**
 * Groups connected/nearby paths by network for the "Cycling infrastructure here" section.
 * Browser-safe — no .server.ts, no node:* imports.
 */

export interface NetworkMeta {
  name: string;
  length_km?: number;
  operator?: string;
}

/** Build network slug → meta lookup from pages that have memberRefs. */
export function buildNetworkMeta(pages: Array<{ slug: string; name: string; length_km?: number; operator?: string; memberRefs?: unknown[] }>): Record<string, NetworkMeta> {
  const meta: Record<string, NetworkMeta> = {};
  for (const p of pages) {
    if (p.memberRefs && p.memberRefs.length > 0) {
      meta[p.slug] = { name: p.name, length_km: p.length_km, operator: p.operator };
    }
  }
  return meta;
}

// ── Member tiering ──────────────────────────────────────────────────

interface TierableMember {
  slug: string;
  name: string;
  length_km?: number;
  hasMarkdown: boolean;
  memberOf?: string;
  entryType?: string;
  overlappingRelations?: Array<{ id: number; name: string; route: string }>;
  standalone: boolean;
}

export interface TieredMembers<T extends TierableMember> {
  longDistanceMembers: T[];
  ungroupedPrimary: T[];
  displayOverlapGroups: Array<{ name: string; route: string; members: T[] }>;
  primaryTier2: T[];
  secondaryMembers: T[];
}

const MIN_DISPLAY_KM = 0.5;
const TIER1_MIN_KM = 3;

/** Tier network members into display groups. Pure data transformation — no i18n, no locale. */
export function tierNetworkMembers<T extends TierableMember>(
  allMemberRefs: T[],
  networkSlug: string,
  isMtbNetwork: boolean,
): TieredMembers<T> {
  const memberRefs = allMemberRefs.filter(m => m.length_km == null || m.length_km >= MIN_DISPLAY_KM);

  const allPrimary = memberRefs
    .filter(m => !m.memberOf || m.memberOf === networkSlug)
    .sort((a, b) => a.name.localeCompare(b.name));
  const allSecondary = memberRefs
    .filter(m => m.memberOf && m.memberOf !== networkSlug)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Long-distance members get their own section
  const longDistanceMembers = [...allPrimary, ...allSecondary]
    .filter(m => m.entryType === 'long-distance');
  const longDistanceSlugs = new Set(longDistanceMembers.map(m => m.slug));

  // Primary tier 1/2 (excluding long-distance)
  const nonLdPrimary = allPrimary.filter(m => !longDistanceSlugs.has(m.slug));
  let primaryMembers: T[];
  let primaryTier2: T[];
  if (isMtbNetwork) {
    primaryMembers = nonLdPrimary;
    primaryTier2 = [];
  } else {
    primaryMembers = nonLdPrimary.filter(m => m.hasMarkdown || (m.length_km != null && m.length_km >= TIER1_MIN_KM));
    primaryTier2 = nonLdPrimary.filter(m => !m.hasMarkdown && (m.length_km == null || m.length_km < TIER1_MIN_KM));
    if (primaryMembers.length === 0 && primaryTier2.length > 0) {
      primaryMembers = nonLdPrimary;
      primaryTier2 = [];
    }
  }

  const secondaryMembers = allSecondary.filter(m => !longDistanceSlugs.has(m.slug));

  // Group primary members by shared non-cycling relation
  const overlapGroups = new Map<number, { name: string; route: string; members: T[] }>();
  const ungroupedPrimary: T[] = [];
  for (const m of primaryMembers) {
    const rels = m.overlappingRelations ?? [];
    if (rels.length > 0) {
      const rel = rels[0];
      if (!overlapGroups.has(rel.id)) {
        overlapGroups.set(rel.id, { name: rel.name, route: rel.route, members: [] });
      }
      overlapGroups.get(rel.id)!.members.push(m);
    } else {
      ungroupedPrimary.push(m);
    }
  }
  const displayOverlapGroups: Array<{ name: string; route: string; members: T[] }> = [];
  for (const [, g] of overlapGroups) {
    if (g.members.length >= 2) {
      displayOverlapGroups.push(g);
    } else {
      ungroupedPrimary.push(...g.members);
    }
  }
  ungroupedPrimary.sort((a, b) => a.name.localeCompare(b.name));

  return { longDistanceMembers, ungroupedPrimary, displayOverlapGroups, primaryTier2, secondaryMembers };
}

// ── Infrastructure grouping ─────────────────────────────────────────

interface RelatedPath {
  slug: string;
  name: string;
  surface?: string;
  memberOf?: string;
}

export interface GroupedPath {
  slug: string;
  name: string;
  surface?: string;
  relation: 'connects' | 'nearby';
}

export interface NetworkGroup {
  slug: string;
  name: string;
  length_km?: number;
  operator?: string;
  isOwn: boolean;
  paths: GroupedPath[];
}

export interface InfrastructureGrouping {
  networkGroups: NetworkGroup[];
  otherPaths: GroupedPath[];
}

export function groupPathsByNetwork(opts: {
  connectedPaths: RelatedPath[];
  nearbyPaths: RelatedPath[];
  ownNetwork: string | undefined;
  networkMeta: Record<string, NetworkMeta>;
}): InfrastructureGrouping {
  const { connectedPaths, nearbyPaths, ownNetwork, networkMeta } = opts;

  // Build a map of slug → { path, relation }, connected takes priority
  const pathMap = new Map<string, { path: RelatedPath; relation: 'connects' | 'nearby' }>();
  for (const p of connectedPaths) {
    pathMap.set(p.slug, { path: p, relation: 'connects' });
  }
  for (const p of nearbyPaths) {
    if (!pathMap.has(p.slug)) {
      pathMap.set(p.slug, { path: p, relation: 'nearby' });
    }
  }

  // Group by memberOf
  const groups = new Map<string, GroupedPath[]>();
  const ungrouped: GroupedPath[] = [];

  for (const { path, relation } of pathMap.values()) {
    const grouped: GroupedPath = { slug: path.slug, name: path.name, surface: path.surface, relation };
    if (path.memberOf && networkMeta[path.memberOf]) {
      const list = groups.get(path.memberOf);
      if (list) list.push(grouped);
      else groups.set(path.memberOf, [grouped]);
    } else {
      ungrouped.push(grouped);
    }
  }

  // Build network groups, own network first
  const networkGroups: NetworkGroup[] = [];
  if (ownNetwork && groups.has(ownNetwork)) {
    const meta = networkMeta[ownNetwork];
    networkGroups.push({
      slug: ownNetwork,
      name: meta?.name ?? ownNetwork,
      length_km: meta?.length_km,
      operator: meta?.operator,
      isOwn: true,
      paths: groups.get(ownNetwork)!,
    });
    groups.delete(ownNetwork);
  }

  // Remaining networks sorted by path count (most paths first)
  const remaining = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [slug, paths] of remaining) {
    const meta = networkMeta[slug];
    networkGroups.push({
      slug,
      name: meta?.name ?? slug,
      length_km: meta?.length_km,
      operator: meta?.operator,
      isOwn: false,
      paths,
    });
  }

  return { networkGroups, otherPaths: ungrouped };
}
