import { defineConfig } from '@playwright/test';

// In CI (no .env file), the build uses the Cloudflare adapter and astro preview
// runs on Workerd via @cloudflare/vite-plugin — the same runtime as production.
// This means SSR tests here catch Workerd-specific issues like missing renderers.
export default defineConfig({
  testDir: '.',
  testMatch: ['screenshots.spec.ts', 'functional.spec.ts', 'expandable-map.spec.ts', 'map-components.spec.ts', 'big-map-layers.spec.ts'],
  fullyParallel: true,
  retries: 2,
  workers: '75%',
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
    // Use wrangler dev instead of astro preview — the @cloudflare/vite-plugin
    // miniflare bridge can fail with "Expected miniflare to be defined" on
    // certain dependency versions. wrangler dev runs the same Cloudflare Workers
    // runtime but bypasses the Vite preview layer.
    command: 'npx wrangler dev --port 4322 --config dist/server/wrangler.json',
    port: 4322,
    cwd: '..',
    reuseExistingServer: true,
    // Workerd logs noisy kj:: disconnected/broken-pipe errors when browsers
    // close connections mid-request (normal in test teardown). Silence them.
    stderr: 'ignore',
  },
});
