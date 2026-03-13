/**
 * Build a flat redirect map for ride URLs, used by middleware at runtime.
 *
 * Two sources feed into this:
 * 1. `redirects.yml` rides section (old slug → canonical slug)
 * 2. Tour ride redirects (/rides/{slug} → /tours/{tour}/{slug})
 *
 * Keys are full paths (e.g. "/rides/old-slug"), values are target paths.
 * Includes /map variants for each entry.
 */
export function buildRideRedirectMap(
  rideRedirectEntries: Array<{ from: string; to: string }>,
  tourRedirects: string[],
): Record<string, string> {
  const map: Record<string, string> = {};

  // From redirects.yml rides section
  for (const r of rideRedirectEntries) {
    map[`/rides/${r.from}`] = `/rides/${r.to}`;
    map[`/rides/${r.from}/map`] = `/rides/${r.to}/map`;
  }

  // From tour ride redirects (formatted as "_redirects" lines: "source  target  301")
  for (const line of tourRedirects) {
    const parts = line.split(/\s+/);
    if (parts.length >= 2) {
      map[parts[0]] = parts[1];
    }
  }

  return map;
}
