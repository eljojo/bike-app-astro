/** Sanitize a username for safe use as a handle. Lowercase, slug-safe. */
export function sanitizeUsername(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30)
    || 'anonymous';
}

/** Generate a username from an email address. Uses the local part, sanitized. */
export function generateUsernameFromEmail(email: string): string {
  const prefix = email.split('@')[0] || '';
  let username = sanitizeUsername(prefix);

  if (username.length < 2) {
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(2)), b => b.toString(16).padStart(2, '0')).join('');
    username = sanitizeUsername(`${prefix}-${hex}`);
  }

  return username;
}

/** Check if a username is valid (already sanitized form). */
export function isValidUsername(name: string): boolean {
  return /^[a-z0-9][a-z0-9_-]*[a-z0-9]$/.test(name) && name.length >= 2 && name.length <= 30;
}
