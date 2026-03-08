/**
 * Single Playwright config for all admin E2E tests.
 *
 * Calls prepareFixture() at import time to guarantee the fixture content
 * directory exists before the webServer command evaluates astro.config.mjs.
 *
 * All specs run in parallel across workers. Git write contention is handled
 * by a mutex in LocalGitService — concurrent saves queue rather than race.
 * Each write spec owns dedicated fixture routes, so there are no semantic
 * conflicts between specs. Tests within a spec file run sequentially
 * (fullyParallel: false) to preserve intra-file ordering where needed.
 */
import { defineConfig } from '@playwright/test';
import {
  FIXTURE_DIR,
  DB_PATH,
  UPLOADS_DIR,
  prepareFixture,
} from './fixture-setup.ts';

// Re-export for tests that need these paths
export { FIXTURE_DIR, DB_PATH, UPLOADS_DIR };

// Create fixture before the webServer starts
prepareFixture();

const port = 4323;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 4,
  retries: 2,
  outputDir: '../test-results',
  snapshotPathTemplate: '{testDir}/{testFileDir}/{testFileName}-snapshots/{arg}-chromium-{platform}{ext}',
  use: {
    viewport: { width: 1280, height: 900 },
    baseURL,
    browserName: 'chromium',
  },
  webServer: {
    command: `RUNTIME=local CITY=demo CONTENT_DIR="${FIXTURE_DIR}" R2_PUBLIC_URL="${baseURL}/dev-uploads" npx astro build && RUNTIME=local CITY=demo CONTENT_DIR="${FIXTURE_DIR}" LOCAL_DB_PATH="${DB_PATH}" LOCAL_UPLOADS_DIR="${UPLOADS_DIR}" R2_PUBLIC_URL="${baseURL}/dev-uploads" npx astro preview --port ${port}`,
    port,
    cwd: '../..',
    reuseExistingServer: false,
    timeout: 180000,
  },
});
