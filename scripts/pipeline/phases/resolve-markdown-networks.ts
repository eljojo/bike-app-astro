// scripts/pipeline/phases/resolve-markdown-networks.ts
//
// Rule 5 (Stage 1.5): emit a bikepaths.yml network entry for each markdown
// file that declares a multi-entry page via `includes:`. Runs after
// finalize-overrides (so markdown member_of moves are already applied) and
// before finalize-resolve (so slugs and `members:` arrays are resolved
// alongside the rest of the entries).
//
// Skips slugs that already have a matching YML entry — those are
// pipeline-derived networks that the markdown overlays at read time;
// no new entry needed.

import type { Phase } from './_phase-types.ts';
import type { MarkdownIncludesDecl } from '../lib/pipeline-io.ts';
import { slugifyBikePathName as slugify } from '../../../src/lib/bike-paths/bikepaths-yml.server.ts';

interface Inputs {
  entries: any[];
  markdownIncludes: MarkdownIncludesDecl[];
}

export const resolveMarkdownNetworksPhase: Phase<Inputs, any[]> = async ({ entries, markdownIncludes, ctx }) => {
  if (markdownIncludes.length === 0) return entries;

  const grouped = [...entries];
  const bySlug = new Map<string, any>();
  for (const e of grouped) {
    const s = slugify(e.name ?? '');
    if (s) bySlug.set(s, e);
  }

  let added = 0;
  for (const decl of markdownIncludes) {
    // Skip if pipeline already emitted a matching entry (OSM relation or
    // auto-group network with the same slug). Markdown overlay at read time
    // handles those via `includes:` → memberRefs.
    if (bySlug.has(decl.slug)) continue;

    // Resolve included slugs to actual entry objects. Members must exist.
    const memberRefs: any[] = [];
    for (const memberSlug of decl.includes) {
      const member = bySlug.get(memberSlug);
      if (member) memberRefs.push(member);
    }
    if (memberRefs.length < 2) {
      // Under 2 resolved members is not a useful network. Skip silently —
      // the markdown may have referenced slugs that the pipeline didn't
      // produce, or the city is a different data shape.
      continue;
    }

    const networkEntry: any = {
      name: decl.name ?? decl.slug,
      type: 'network',
      _memberRefs: memberRefs,
      _source: 'markdown-includes',
    };
    if (decl.name_fr) networkEntry.name_fr = decl.name_fr;
    if (decl.operator) networkEntry.operator = decl.operator;
    if (decl.related && decl.related.length > 0) networkEntry.related = decl.related;

    // Update members' _networkRef only if they're not already in another
    // network. Markdown `includes:` is additive on top of OSM-derived
    // grouping — we don't steal members from auto-group networks.
    for (const m of memberRefs) {
      if (!m._networkRef) m._networkRef = networkEntry;
    }

    grouped.push(networkEntry);
    ctx.trace(`entry:${networkEntry.name}`, 'created', { kind: 'markdown-includes-network', memberCount: memberRefs.length });
    added++;
  }

  if (added > 0) {
    console.log(`Added ${added} markdown-declared network(s) from includes: frontmatter`);
  }

  return grouped;
};
