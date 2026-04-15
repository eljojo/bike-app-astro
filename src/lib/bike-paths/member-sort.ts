/**
 * Two-bucket comparator for ordering a network's members by name:
 *
 *   1. Named entries first (no digit in the name), alphabetical.
 *   2. Numbered entries after, ordered by the FIRST number in the name
 *      (irrespective of prefix text), tiebroken alphabetically.
 *
 * Matches the pipeline's `memberSort` comparator (scripts/pipeline/lib/
 * city-adapter.mjs → naturalNameSort) so build-time (bikepaths.yml) and
 * runtime (Astro views) produce the same order. See
 * tests/pipeline/lib/city-adapter.test.mjs for the full spec.
 *
 * Browser-safe — no server-only imports.
 */

/* eslint-disable bike-app/no-hardcoded-city-locale -- sort stability: must match the pipeline's memberSort (scripts/pipeline/lib/city-adapter.mjs) regardless of the rendering city. `sensitivity: 'base'` does the real work; 'en' is only a collator seed. */
const namedBucketCollator = new Intl.Collator('en', { sensitivity: 'base' });
const tiebreakCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
/* eslint-enable bike-app/no-hardcoded-city-locale */

function firstNumberIn(name: string | undefined | null): number | null {
  if (!name) return null;
  const m = String(name).match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

export function compareMemberNames(
  a: { name?: string | null },
  b: { name?: string | null },
): number {
  const aNum = firstNumberIn(a?.name);
  const bNum = firstNumberIn(b?.name);

  // Named bucket first.
  if (aNum === null && bNum !== null) return -1;
  if (aNum !== null && bNum === null) return 1;

  // Both named: alphabetical.
  if (aNum === null && bNum === null) {
    return namedBucketCollator.compare(a?.name || '', b?.name || '');
  }

  // Both numbered: sort by extracted number; tiebreak alphabetically so
  // "Sentier 5" and "Trail 5" sit next to each other in a stable order.
  if (aNum !== bNum) return (aNum as number) - (bNum as number);
  return tiebreakCollator.compare(a?.name || '', b?.name || '');
}
