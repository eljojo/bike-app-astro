// scripts/pipeline/phases/finalize-overrides.ts
//
// Phase 10: apply markdown frontmatter overrides to entries.
//
// Steps from legacy resolve():
//   8b. Apply overrides (path_type, type, operator; special handling for member_of)
//   8b-cleanup-1. Scrub self-references from network _memberRefs
//   8b-cleanup-2. Remove zombie networks (0 members)
//
// Operates on entries array in place, returns it.

import type { Phase } from './_phase-types.ts';
import { slugifyBikePathName as slugify } from '../../../src/lib/bike-paths/bikepaths-yml.server.ts';

interface Inputs {
  entries: any[];
  markdownOverrides: Map<string, Record<string, any>>;
}

export const finalizeOverridesPhase: Phase<Inputs, any[]> = async ({ entries, markdownOverrides, ctx }) => {
  const grouped = entries;

  // Step 8b: Apply markdown overrides
  if (markdownOverrides.size > 0) {
    for (const [mdSlug, override] of markdownOverrides) {
      const entry = grouped.find((e: any) => e.type !== 'network' && slugify(e.name) === mdSlug);
      if (!entry) continue;

      // Simple field overwrites (path_type, operator, etc.)
      for (const [field, value] of Object.entries(override)) {
        if (field === 'member_of') continue; // handled below
        const oldValue = entry[field];
        entry[field] = value;
        ctx.trace(`entry:${entry.name}`, 'overridden', { field, oldValue, newValue: value });
      }

      if (!override.member_of) continue;

      const targetNet = grouped.find((e: any) =>
        e.type === 'network' && slugify(e.name) === override.member_of
      );
      if (!targetNet) {
        throw new Error(
          `Markdown override: ${mdSlug} has member_of: "${override.member_of}" ` +
          `but no network with that slug exists. Check ${mdSlug}.md frontmatter.`
        );
      }

      // Remove from old network's _memberRefs
      if (entry._networkRef && entry._networkRef._memberRefs) {
        entry._networkRef._memberRefs = entry._networkRef._memberRefs.filter((m: any) => m !== entry);
      }

      const oldNetworkName = entry._networkRef?.name;
      entry._networkRef = targetNet;
      if (!targetNet._memberRefs) targetNet._memberRefs = [];
      if (!targetNet._memberRefs.includes(entry)) {
        targetNet._memberRefs.push(entry);
      }
      ctx.trace(`entry:${entry.name}`, 'overridden', { field: 'member_of', oldValue: oldNetworkName, newValue: targetNet.name });
    }
  }

  // Scrub self-references: a network's _memberRefs must not contain itself
  for (const e of grouped) {
    if (e.type !== 'network' || !e._memberRefs) continue;
    e._memberRefs = e._memberRefs.filter((m: any) => m !== e);
  }

  // Cleanup: remove zombie networks with 0 members
  const zombies = grouped.filter((e: any) => e.type === 'network' && (!e._memberRefs || e._memberRefs.length === 0));
  if (zombies.length > 0) {
    for (const z of zombies) {
      const idx = grouped.indexOf(z);
      if (idx !== -1) grouped.splice(idx, 1);
      ctx.trace(`entry:${z.name}`, 'dropped', { reason: 'empty-network' });
    }
    console.log(`  Removed ${zombies.length} empty networks`);
  }

  return grouped;
};
