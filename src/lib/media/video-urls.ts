/**
 * Client-safe video URL builders.
 *
 * These are pure functions with no Node.js or server-side imports,
 * safe to use in Preact islands and other client-side code.
 */

/**
 * Build the path portion of a video poster URL (no CDN base).
 * @param key - Video key, may include instance prefix ("ottawa/abc123") or be bare ("abc123")
 * @param defaultPrefix - Fallback prefix when key has no slash (e.g., "ottawa")
 */
export function videoPosterPath(key: string, defaultPrefix?: string): string {
  const slashIdx = key.indexOf('/');
  const prefix = slashIdx !== -1 ? key.slice(0, slashIdx) : (defaultPrefix || '');
  const bareKey = slashIdx !== -1 ? key.slice(slashIdx + 1) : key;
  return prefix
    ? `${prefix}/${bareKey}/${bareKey}-poster.0000000.jpg`
    : `${bareKey}/${bareKey}-poster.0000000.jpg`;
}

/**
 * Build a video poster thumbnail URL from a CDN base and video key.
 * @param cdnBase - Video CDN base URL (e.g., "https://videos.ottawabybike.ca")
 * @param key - Video key, may include instance prefix ("ottawa/abc123") or be bare ("abc123")
 * @param defaultPrefix - Fallback prefix when key has no slash (e.g., "ottawa")
 */
export function buildVideoPosterUrl(cdnBase: string, key: string, defaultPrefix?: string): string {
  return `${cdnBase}/${videoPosterPath(key, defaultPrefix)}`;
}
