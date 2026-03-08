/**
 * Single Playwright config for all admin E2E tests.
 *
 * Uses globalSetup to create the fixture content directory exactly once
 * before the webServer starts, even with multiple parallel workers.
 *
 * Tests are split into two projects:
 *   - "read"  — specs that only read data (parallel, workers: 2)
 *   - "write" — specs that commit to git (serial after read finishes)
 *
 * This avoids git lock contention between concurrent saves while still
 * parallelizing the read-only specs.
 */
import { defineConfig } from '@playwright/test';
import {
  FIXTURE_DIR,
  DB_PATH,
  UPLOADS_DIR,
} from './fixture-setup.ts';

// Re-export for tests that need these paths
export { FIXTURE_DIR, DB_PATH, UPLOADS_DIR };

const port = 4323;
const baseURL = `http://localhost:${port}`;

/** Read-only specs — no git commits, safe to run in parallel. */
const readSpecs = [
  'admin-screenshots.spec.ts', // guest save modal writes to carp, but runs before write specs start
  'body.spec.ts',
  'tags.spec.ts',
  'settings.spec.ts',
];

/** Writing specs — commit to git, run after read specs finish. */
const writeSpecs = [
  'save.spec.ts',
  'parking.spec.ts',
  'community-editing.spec.ts',
  'events.spec.ts',
  'route-create.spec.ts',
  'places.spec.ts',
];

export default defineConfig({
  globalSetup: './global-setup.ts',
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  retries: 2,
  outputDir: '../test-results',
  snapshotPathTemplate: '{testDir}/{testFileDir}/{testFileName}-snapshots/{arg}-chromium-{platform}{ext}',
  use: {
    viewport: { width: 1280, height: 900 },
    baseURL,
    browserName: 'chromium',
  },
  projects: [
    {
      name: 'read',
      testMatch: readSpecs,
    },
    {
      name: 'write',
      testMatch: writeSpecs,
      dependencies: ['read'],
    },
  ],
  webServer: {
    command: `RUNTIME=local CITY=demo CONTENT_DIR="${FIXTURE_DIR}" R2_PUBLIC_URL="${baseURL}/dev-uploads" npx astro build && RUNTIME=local CITY=demo CONTENT_DIR="${FIXTURE_DIR}" LOCAL_DB_PATH="${DB_PATH}" LOCAL_UPLOADS_DIR="${UPLOADS_DIR}" R2_PUBLIC_URL="${baseURL}/dev-uploads" npx astro preview --port ${port}`,
    port,
    cwd: '../..',
    reuseExistingServer: false,
    timeout: 180000,
  },
});
