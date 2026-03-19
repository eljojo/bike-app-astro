/**
 * Follow redirects to resolve a shortened URL to its final destination.
 * Returns the original URL if no redirect or on error.
 * Follows up to 3 redirects to prevent infinite loops.
 */
export async function resolveUrl(url: string, limit = 3): Promise<string> {
  if (limit === 0 || !url.startsWith('http')) return url;
  try {
    const res = await fetch(url, { redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (location) return resolveUrl(location, limit - 1);
    }
    return res.url || url;
  } catch {
    return url;
  }
}
