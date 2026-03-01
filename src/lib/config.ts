import path from 'node:path';

export const CONTENT_DIR = process.env.CONTENT_DIR || path.resolve('..', 'bike-routes');
export const CITY = process.env.CITY || 'ottawa';
export const cityDir = path.join(CONTENT_DIR, CITY);
