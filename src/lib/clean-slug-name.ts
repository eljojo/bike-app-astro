/**
 * Clean legacy junk from a ride slug:
 * 1. Strip leading dashes (from double-dash GPX filenames)
 * 2. Strip 3+ digit numeric prefix (Strava/Rails IDs like 302-evening-ride)
 * 3. Strip trailing 4-char hex-like hash suffix (dedup hashes like -6136)
 *
 * Preserves 1-2 digit numbers that are part of the name (6-sprints, 31-the-1250).
 * Preserves date prefixes (2025-06-15-name) since those are 4 digits.
 */
export function cleanSlugName(slug: string): string {
  let s = slug;

  // 1. Strip leading dashes
  s = s.replace(/^-+/, '');

  // 2. Strip 3+ digit numeric prefix (but not 1-2 digit, those are part of the name)
  // Skip date prefixes (YYYY-MM-DD-...) — those are intentional
  // Only strip if something remains after the prefix
  const isDatePrefix = /^\d{4}-\d{2}-\d{2}-/.test(s);
  if (!isDatePrefix) {
    const numericPrefixMatch = s.match(/^(\d{3,})-(.+)/);
    if (numericPrefixMatch) {
      s = numericPrefixMatch[2];
    }
  }

  // 3. Strip trailing 4-char hex-like hash suffix (dedup hashes from Rails export)
  // Must contain at least one hex letter (a-f) to distinguish from meaningful
  // numbers like 1250 (brevet distance) or 2024 (year).
  // Pure-digit suffixes (e.g. afternoon-ride-6136) are left — collision handling
  // in the migration resolves them.
  const hashMatch = s.match(/^(.+)-(?=[0-9a-f]*[a-f])[0-9a-f]{4}$/);
  if (hashMatch) {
    s = hashMatch[1];
  }

  return s;
}
