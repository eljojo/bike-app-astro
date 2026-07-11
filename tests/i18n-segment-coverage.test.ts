import { describe, it, expect } from 'vitest';

import { sharedPages, wikiPages, blogPages, clubPages, type LocalePage } from '../src/integrations/i18n-routes';
import { getSegmentTranslations } from '../src/lib/i18n/segment-registry';

/**
 * Segments deliberately excluded from translation: data endpoints, not
 * navigable pages. `translatePath` only matches whole segments, so
 * `routes.json` never collides with the `routes` registry entry — it
 * passes through unchanged by design.
 */
const untranslatedAllowlist = new Set(['routes.json']);

/** Top-level (first path component) segment of a route pattern, or null for the root. */
function topSegment(pattern: string): string | null {
  const [, first] = pattern.split('/');
  return first || null;
}

describe('i18n segment-registry coverage', () => {
  it('has a segment-registry entry for every locale-prefixed top-level route segment', () => {
    const allPages: LocalePage[] = [...sharedPages, ...wikiPages, ...blogPages, ...clubPages];
    const segments = new Set(
      allPages
        .map(page => topSegment(page.pattern))
        .filter((segment): segment is string => segment !== null),
    );

    const registry = getSegmentTranslations();
    const missing = [...segments].filter(
      segment => !(segment in registry) && !untranslatedAllowlist.has(segment),
    );

    expect(missing).toEqual([]);
  });
});
