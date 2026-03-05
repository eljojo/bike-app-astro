import path from 'node:path';

export const CONTENT_DIR = process.env.CONTENT_DIR || path.resolve('..', 'bike-routes');
export const CITY = process.env.CITY || 'ottawa';
export const cityDir = path.join(CONTENT_DIR, CITY);

// Git repository configuration
export const GIT_OWNER = process.env.GIT_OWNER || 'eljojo';
export const GIT_DATA_REPO = process.env.GIT_DATA_REPO || 'bike-routes';
export const GIT_REPO = `${GIT_OWNER}/${GIT_DATA_REPO}`;

// Site configuration
export const SITE_URL = process.env.SITE_URL || 'https://ottawabybike.ca';
export const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'bike@eljojo.net';

/** Default CDN URL fallback (used when R2_PUBLIC_URL is not set). */
export const CDN_FALLBACK_URL = process.env.R2_PUBLIC_URL || 'https://cdn.ottawabybike.ca';
