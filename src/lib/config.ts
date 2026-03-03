import path from 'node:path';

export const CONTENT_DIR = process.env.CONTENT_DIR || path.resolve('..', 'bike-routes');
export const CITY = process.env.CITY || 'ottawa';
export const cityDir = path.join(CONTENT_DIR, CITY);

// Git repository configuration
export const GIT_OWNER = 'eljojo';
export const GIT_DATA_REPO = 'bike-routes';
export const GIT_APP_REPO = 'bike-app-astro';
