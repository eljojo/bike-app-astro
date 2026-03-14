/**
 * Build a flat redirect map for ride URLs, used by middleware at runtime.
 *
 * Source: `redirects.yml` rides section.
 * - Simple entries (no `/` in `to`): /rides/{from} → /rides/{to}
 * - Tour entries (`to` contains `/`): /rides/{from} → /tours/{to}
 *
 * Keys are full paths (e.g. "/rides/old-slug"), values are target paths.
 * Includes /map variants for each entry.
 */
export function buildRideRedirectMap(
  rideRedirectEntries: Array<{ from: string; to: string }>,
): Record<string, string> {
  const map: Record<string, string> = {};

  for (const r of rideRedirectEntries) {
    if (r.to.includes('/')) {
      // Tour ride redirect: /rides/{slug} → /tours/{tour}/{slug}
      map[`/rides/${r.from}`] = `/tours/${r.to}`;
      map[`/rides/${r.from}/map`] = `/tours/${r.to}/map`;
    } else {
      // Simple ride slug redirect: /rides/{old} → /rides/{new}
      map[`/rides/${r.from}`] = `/rides/${r.to}`;
      map[`/rides/${r.from}/map`] = `/rides/${r.to}/map`;
    }
  }

  return map;
}
