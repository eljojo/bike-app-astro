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
 * Independent scripts run in parallel where possible. Dependencies:
 *   - build-map-style, build-icon-paths, build-contributors: independent
 *   - cache-path-geometry → copy-path-geometry (sequential)
 *   - generate-path-tiles, generate-maps: depend on copy-path-geometry
 */
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFile = promisify(execFileCb);

const scripts = path.resolve(import.meta.dirname);
const minimal = process.env.PREBUILD_MINIMAL === '1';

interface Generator {
  name: string;
  script: string;
}

async function run(gen: Generator): Promise<void> {
  try {
    const { stdout, stderr } = await execFile('npx', ['tsx', path.join(scripts, gen.script)], {
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    if (e.stdout) process.stdout.write(e.stdout);
    if (e.stderr) process.stderr.write(e.stderr);
    console.error(`[prebuild] ${gen.name} failed`);
    process.exit(1);
  }
}

async function runAll(gens: Generator[]): Promise<void> {
  await Promise.all(gens.map(g => run(g)));
}

async function main() {
  // Phase 1: Independent generators (parallel)
  const phase1: Generator[] = [
    { name: 'map-style', script: 'build-map-style.ts' },
    { name: 'icon-paths', script: 'build-icon-paths.ts' },
  ];
  if (!minimal) {
    phase1.push({ name: 'contributors', script: 'build-contributors.ts' });
  }

  // Phase 2: Geometry cache (must complete before copy)
  const geometryCache: Generator = { name: 'path-geo-cache', script: 'cache-path-geometry.ts' };

  // Run phase 1 and geometry cache in parallel
  await Promise.all([
    runAll(phase1),
    run(geometryCache),
  ]);

  // Phase 3: Copy geometry (depends on cache)
  await run({ name: 'path-geo', script: 'copy-path-geometry.ts' });

  // Phase 4: Post-geometry generators (parallel, depend on copy)
  const phase4: Generator[] = [
    { name: 'path-tiles', script: 'generate-path-tiles.ts' },
  ];
  if (!minimal) {
    phase4.push({ name: 'maps', script: 'generate-maps.ts' });
  }
  await runAll(phase4);
}

main();
