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
 *
 * Dependencies are wired through promises — each task starts as soon as
 * its inputs resolve. Read the `.then()` chains to see the graph:
 *
 *   map-style ─────────────┐
 *   icon-paths ────────────┤
 *   contributors ──────────┤
 *   map-manifests ─────────┤
 *                          ├─► done
 *   cache-path-geometry ───┤
 *     └─► geo-metadata
 *           └─► path-tiles
 */
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFile = promisify(execFileCb);

const scripts = path.resolve(import.meta.dirname);
const minimal = process.env.PREBUILD_MINIMAL === '1';

async function run(name: string, script: string): Promise<void> {
  try {
    const { stdout, stderr } = await execFile('npx', ['tsx', path.join(scripts, script)], {
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    if (e.stdout) process.stdout.write(e.stdout);
    if (e.stderr) process.stderr.write(e.stderr);
    console.error(`[prebuild] ${name} failed`);
    process.exit(1);
  }
}

// Dependency graph — each task awaits only its actual inputs.
const mapStyle     = run('map-style',      'build-map-style.ts');
const iconPaths    = run('icon-paths',     'build-icon-paths.ts');
const contributors = minimal ? Promise.resolve() : run('contributors', 'build-contributors.ts');

const geoCache  = run('path-geo-cache', 'cache-path-geometry.ts');
const geoMeta   = geoCache.then(() => run('geo-metadata', 'generate-geo-metadata.ts'));
const pathTiles = geoMeta.then(() => run('path-tiles', 'generate-path-tiles.ts'));
const mapManifests = run('map-manifests', 'generate-map-manifests.ts');

await Promise.all([mapStyle, iconPaths, contributors, pathTiles, mapManifests]);
