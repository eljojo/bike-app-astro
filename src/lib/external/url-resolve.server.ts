/** Mock redirects for E2E tests — avoids calling Google's shortener service. */
const MOCK_REDIRECTS: Record<string, string> = {
  'https://maps.app.goo.gl/uQWQGNiiDh4tSXMh8':
    'https://www.google.com/maps/dir/The+Royal+Oak+-+Centrepointe,+117+Centrepointe+Dr+Unit+105,+Ottawa,+ON+K2G+5X3,+Canada/45.3268492,-75.8054197/Eaton+St,+Ottawa,+ON,+Canada/Whiprsnapr+Brewing+Co.,+14+Bexley+Pl+%23106,+Nepean,+ON+K2H+8W2,+Canada/@45.3347906,-75.8121228,14z/data=!3m1!4b1!4m21!4m20!1m5!1m1!1s0x4cce073d66aaaaab:0xd95fe42b230f3abd!2m2!1d-75.7625!2d45.3430556!1m0!1m5!1m1!1s0x4cce00a16d004239:0x528e8d2b0373771f!2m2!1d-75.8173974!2d45.3264109!1m5!1m1!1s0x4cce00a2800ba81d:0xdadad1e1f95c4a96!2m2!1d-75.819541!2d45.3301965!3e1',
};

/**
 * Follow redirects to resolve a shortened URL to its final destination.
 * Returns the original URL if no redirect or on error.
 *
 * Strategy: first try redirect: 'follow' (lets the runtime follow redirects
 * natively and returns the final URL via res.url). Falls back to manual
 * redirect following for environments where res.url isn't populated.
 */
export async function resolveUrl(url: string): Promise<string> {
  if (process.env.MOCK_DIRECTIONS_API && MOCK_REDIRECTS[url]) {
    return MOCK_REDIRECTS[url];
  }
  if (!url.startsWith('http')) return url;
  try {
    // Let the runtime follow redirects — res.url is the final destination
    const res = await fetch(url, { redirect: 'follow' });
    if (res.url && res.url !== url) return res.url;

    // Fallback: manual redirect following (up to 3 hops)
    return await resolveManual(url, 3);
  } catch (err) {
    console.error('resolveUrl error:', err);
    return url;
  }
}

async function resolveManual(url: string, limit: number): Promise<string> {
  if (limit === 0) return url;
  try {
    const res = await fetch(url, { redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (location) return resolveManual(location, limit - 1);
    }
    return url;
  } catch {
    return url;
  }
}
