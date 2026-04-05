/**
 * Groups connected/nearby paths by network for the "Cycling infrastructure here" section.
 * Browser-safe — no .server.ts, no node:* imports.
 */

export interface NetworkMeta {
  name: string;
  length_km?: number;
  operator?: string;
}

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
