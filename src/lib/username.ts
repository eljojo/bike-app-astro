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

/** Check if a username is valid (already sanitized form). */
export function isValidUsername(name: string): boolean {
  return /^[a-z0-9][a-z0-9_-]*[a-z0-9]$/.test(name) && name.length >= 2 && name.length <= 30;
}
