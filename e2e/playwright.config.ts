import { defineConfig } from '@playwright/test';

// In CI (no .env file), the build uses the Cloudflare adapter and astro preview
// runs on Workerd via @cloudflare/vite-plugin — the same runtime as production.
// This means SSR tests here catch Workerd-specific issues like missing renderers.
export default defineConfig({
  testDir: '.',
  testMatch: ['screenshots.spec.ts', 'functional.spec.ts'],
  fullyParallel: true,
  workers: '100%',
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
    command: 'npx astro preview --port 4322',
    port: 4322,
    cwd: '..',
    reuseExistingServer: true,
  },
});
