// scripts/pipeline/lib/suppress-empty-wrappers.ts
//
// Rule 6 (Stage 2): suppress pipeline-synthesized empty network wrappers.
//
// Pipeline auto-group sometimes emits a "<Name> Trails" network that
// wraps a real "<Name>" path entry when OSM has both. The wrapper has
// no OSM relation of its own — it's purely a pipeline artefact from
// the name-clustering step. User-facing, it produces two confusing
// index entries where only one real trail exists.
//
// Rule: a network whose slug ends in `-trails` AND which has no OSM
// relations of its own AND whose name-stem matches an existing
// non-network entry in the pipeline output is an empty wrapper. Drop
// it. Former members become orphan standalones (their `_networkRef`
// cleared, `member_of` won't be set when finalize-resolve runs).
//
// Pure function — no I/O, no side effects on non-dropped entries
// beyond clearing _networkRef pointers.

import { slugifyBikePathName as slugify } from '../../../src/lib/bike-paths/bikepaths-yml.server.ts';

export interface MaybeNetwork {
  name?: string;
  type?: string;
  osm_relations?: number[];
  _memberRefs?: Array<{ _networkRef?: unknown; member_of?: unknown; [k: string]: unknown }>;
  [k: string]: unknown;
}

/** Suppress empty `-trails` wrapper networks. Returns a new array. */
export function suppressEmptyWrappers<T extends MaybeNetwork>(entries: T[]): T[] {
  // Build index of non-network entries by slugified name for sibling lookup.
  const nonNetworkBySlug = new Map<string, T>();
  for (const e of entries) {
    if (e.type === 'network') continue;
    const s = slugify(e.name ?? '');
    if (s) nonNetworkBySlug.set(s, e);
  }

  const out: T[] = [];
  for (const e of entries) {
    if (e.type !== 'network') { out.push(e); continue; }
    if ((e.osm_relations ?? []).length > 0) { out.push(e); continue; }

    const nameSlug = slugify(e.name ?? '');
    if (!nameSlug.endsWith('-trails')) { out.push(e); continue; }

    const baseSlug = nameSlug.replace(/-trails$/, '');
    const sibling = nonNetworkBySlug.get(baseSlug);
    if (!sibling) { out.push(e); continue; }

    // Suppress: this network wraps a same-named path. Clear its members'
    // backrefs AND any `member_of` string set by earlier phases
    // (auto-group writes member_of directly; finalize-resolve writes it
    // from _networkRef). Both must be cleared or we'd leave dangling
    // member_of references pointing at the dropped wrapper.
    for (const m of e._memberRefs ?? []) {
      if (m._networkRef === e) delete m._networkRef;
      delete m.member_of;
    }
    // Don't push — the network is dropped.
  }
  return out;
}
