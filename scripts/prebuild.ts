/**
 * Centralized pre-build step — generates all artifacts that must exist
 * before `astro dev`, `astro build`, or `vitest` can run.
 *
 * Called from:
 *   - package.json "prebuild" (npm run build, npm run dev)
 *   - Makefile (make build, make dev, make test, etc.)
 *   - CI workflows (_test.yml, _build-city.yml)
 *
 * Each generator is a standalone script that can also run independently
 * via `npx tsx scripts/build-*.ts` for debugging.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const scripts = path.resolve(import.meta.dirname);

const generators = [
  { name: 'map-style', script: 'build-map-style.ts' },
  { name: 'icon-paths', script: 'build-icon-paths.ts' },
  { name: 'path-geo', script: 'copy-path-geometry.ts' },
  { name: 'maps', script: 'generate-maps.ts' },
  { name: 'contributors', script: 'build-contributors.ts' },
];

for (const { name, script } of generators) {
  try {
    execFileSync('npx', ['tsx', path.join(scripts, script)], {
      stdio: 'inherit',
      env: process.env,
    });
  } catch {
    console.error(`[prebuild] ${name} failed`);
    process.exit(1);
  }
}
