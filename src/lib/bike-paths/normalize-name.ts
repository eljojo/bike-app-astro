/** Normalize a name for comparison — case-insensitive, collapse whitespace/dashes. */
export function normalizeNameForComparison(s: string): string {
  return s.toLowerCase().replace(/[\s\-\u2013\u2014]+/g, ' ').trim();
}

/** Create a URL-safe slug from a segment name. */
export function slugifySegmentName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s\-\u2013\u2014]+/g, '-')
    .replace(/[^a-z0-9\-]/g, '')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '');
}
