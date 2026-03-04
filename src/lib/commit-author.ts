/** Build the commit author email with embedded userId for lookup. */
export function buildAuthorEmail(user: { username: string; id: string; email?: string | null }): string {
  return user.email || `${user.username}+${user.id}@whereto.bike`;
}

/** Parse author email to extract userId (new format) or username (old format). */
export function parseAuthorEmail(email: string): { userId?: string; username?: string } | null {
  // New format: username+userId@whereto.bike
  const newMatch = email.match(/^(.+)\+(.+)@whereto\.bike$/);
  if (newMatch) return { username: newMatch[1], userId: newMatch[2] };

  // Old format: username@whereto.bike
  const oldMatch = email.match(/^(.+)@whereto\.bike$/);
  if (oldMatch) return { username: oldMatch[1] };

  return null;
}

/** Build a regex that matches resource paths for the given city. */
export function buildResourcePathRegex(city: string): RegExp {
  return new RegExp(`${city}/(routes|events|guides|places|organizers)/[\\w/-]+`);
}

/**
 * Parse a content path to extract contentType and contentSlug.
 * Strips file extensions (.md, /index.md) before matching so that
 * the regex (which doesn't match dots) works correctly.
 *
 * E.g. "ottawa/routes/pink-aylmer/index.md" → { contentType: 'routes', contentSlug: 'pink-aylmer' }
 * E.g. "ottawa/events/2026/bike-fest.md" → { contentType: 'events', contentSlug: '2026/bike-fest' }
 */
export function parseContentPath(city: string, contentPath: string): { contentType: string; contentSlug: string } | null {
  const normalized = contentPath
    .replace(/\/index\.md$/, '')
    .replace(/\.md$/, '');

  const re = buildResourcePathRegex(city);
  const match = normalized.match(re);
  if (!match) return null;

  const parts = match[0].split('/');
  const contentType = parts[1];
  const contentSlug = parts.slice(2).join('/');
  return { contentType, contentSlug };
}
