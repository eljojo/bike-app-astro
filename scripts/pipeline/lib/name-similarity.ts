// scripts/pipeline/lib/name-similarity.ts
//
// Token-based name similarity for fragment merging in the named-way
// discovery phase. Tokenize, hard-reject on numeric mismatch, soft Dice
// with edit-distance-1 tolerance.

/**
 * Check if two names are similar enough to consider merging as typo
 * variants (e.g. "Voie Verte Chelsea" vs "Voie Verte de Chelsea").
 */
export function namesAreSimilar(a: string, b: string): boolean {
  const tokenize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\(.*?\)/g, '').match(/[a-z0-9]+/g) || [];
  const editDist1 = (s: string, t: string) => {
    if (Math.abs(s.length - t.length) > 1) return false;
    let diffs = 0;
    if (s.length === t.length) {
      for (let i = 0; i < s.length; i++) { if (s[i] !== t[i]) diffs++; }
      return diffs === 1;
    }
    // length differs by 1 — check for single insertion
    const [short, long] = s.length < t.length ? [s, t] : [t, s];
    let si = 0;
    for (let li = 0; li < long.length; li++) {
      if (short[si] === long[li]) si++;
      else diffs++;
      if (diffs > 1) return false;
    }
    return true;
  };

  const tokA = tokenize(a), tokB = tokenize(b);
  if (tokA.length < 2 || tokB.length < 2) return false;

  // Hard reject: if any numeric token in A has no match in B
  const numA = tokA.filter(t => /^\d+$/.test(t));
  const numB = tokB.filter(t => /^\d+$/.test(t));
  if (numA.length > 0 || numB.length > 0) {
    if (numA.sort().join(',') !== numB.sort().join(',')) return false;
  }

  // Soft Dice: tokens match if identical or (both >= 4 chars and edit distance 1)
  const usedB = new Set<number>();
  let matched = 0;
  for (const ta of tokA) {
    for (let j = 0; j < tokB.length; j++) {
      if (usedB.has(j)) continue;
      const tb = tokB[j];
      if (ta === tb || (ta.length >= 4 && tb.length >= 4 && editDist1(ta, tb))) {
        matched++;
        usedB.add(j);
        break;
      }
    }
  }
  const dice = (2 * matched) / (tokA.length + tokB.length);
  return dice >= 0.85 && matched >= 2;
}
