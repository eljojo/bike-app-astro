import path from 'node:path';

export const CONTENT_DIR = process.env.CONTENT_DIR || path.resolve('..', 'bike-routes');
export const CITY = process.env.CITY || 'ottawa';
export const cityDir = path.join(CONTENT_DIR, CITY);

// Git repository configuration
export const GIT_OWNER = 'eljojo';
export const GIT_DATA_REPO = 'bike-routes';

/** Default CDN URL fallback (used when R2_PUBLIC_URL is not set). */
export const CDN_FALLBACK_URL = 'https://cdn.ottawabybike.ca';
