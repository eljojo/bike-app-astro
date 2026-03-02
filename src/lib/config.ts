import path from 'node:path';

// Resolve from project root (src/lib/config.ts → project root) so paths
// work regardless of process.cwd() (e.g. Playwright starts from e2e/)
const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..');

export const CONTENT_DIR = process.env.CONTENT_DIR
  ? path.resolve(PROJECT_ROOT, process.env.CONTENT_DIR)
  : path.resolve(PROJECT_ROOT, '..', 'bike-routes');
export const CITY = process.env.CITY || 'ottawa';
export const cityDir = path.join(CONTENT_DIR, CITY);
