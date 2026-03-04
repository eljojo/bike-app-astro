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
