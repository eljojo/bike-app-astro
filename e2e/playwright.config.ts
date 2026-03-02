import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: true,
  workers: '100%',
  testIgnore: 'capture-production.spec.ts',
  outputDir: './test-results',
  snapshotDir: './snapshots',
  snapshotPathTemplate: '{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}{ext}',
  use: {
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  webServer: {
    command: 'npx astro preview --port 4322 --root ..',
    port: 4322,
    reuseExistingServer: true,
  },
});
