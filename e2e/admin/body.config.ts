import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DB_PATH = path.resolve(PROJECT_ROOT, '.data', 'local.db');
const UPLOADS_DIR = path.resolve(PROJECT_ROOT, '.data', 'uploads');

export default defineConfig({
  testDir: '.',
  testMatch: 'body.spec.ts',
  fullyParallel: false,
  workers: 1,
  outputDir: '../test-results',
  use: {
    viewport: { width: 1280, height: 900 },
    baseURL: 'http://localhost:4323',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  webServer: {
    command: `RUNTIME=local npx astro build && RUNTIME=local LOCAL_DB_PATH="${DB_PATH}" LOCAL_UPLOADS_DIR="${UPLOADS_DIR}" npx astro preview --port 4323`,
    port: 4323,
    cwd: '../..',
    reuseExistingServer: true,
    timeout: 120000,
  },
});
