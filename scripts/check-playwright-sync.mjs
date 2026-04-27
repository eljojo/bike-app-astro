#!/usr/bin/env node
/**
 * Enforce that `@playwright/test` in package-lock.json matches the Playwright
 * version pinned in flake.nix (via playwright-web-flake/<version>).
 *
 * The nix dev shell provides Chromium binaries via
 *   `PLAYWRIGHT_BROWSERS_PATH=${pw.playwright-driver.browsers}`
 * and sets `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`. Those browsers are built for
 * a specific Playwright version (the flake tag). If the npm-installed
 * @playwright/test is a different version, its browsers.json references a
 * different Chromium revision and Playwright fails to launch with
 *   "Executable doesn't exist at .../chromium_headless_shell-<rev>/...".
 *
 * Run as part of prebuild (catches locally) and as a CI job (catches on PR).
 *
 * Exit non-zero on mismatch, with a message that names both versions so the
 * fix is obvious.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

function readFlakeVersion() {
  const src = fs.readFileSync(path.join(projectRoot, 'flake.nix'), 'utf8');
  const m = src.match(/playwright-web-flake\/(\d+\.\d+\.\d+)/);
  if (!m) {
    throw new Error('flake.nix: could not find playwright-web-flake/<version> input');
  }
  return m[1];
}

function readLockVersion() {
  const lock = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8'));
  const entry = lock.packages?.['node_modules/@playwright/test'];
  if (!entry?.version) {
    throw new Error('package-lock.json: @playwright/test entry missing');
  }
  return entry.version;
}

function readManifestSpec() {
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  return pkg.devDependencies?.['@playwright/test']
      ?? pkg.dependencies?.['@playwright/test']
      ?? null;
}

const flakeVersion = readFlakeVersion();
const lockVersion = readLockVersion();
const manifestSpec = readManifestSpec();

// The manifest must pin the version exactly (no ^, ~, or range) — otherwise
// `npm install` can silently roll the lockfile forward without anyone editing
// flake.nix. This is the failure mode PR #156 hit before we added this check.
const SEMVER_EXACT = /^\d+\.\d+\.\d+$/;
const manifestIsExact = typeof manifestSpec === 'string' && SEMVER_EXACT.test(manifestSpec);

const errors = [];
if (!manifestIsExact) {
  errors.push(
    `package.json: "@playwright/test" must be pinned exactly (got ${JSON.stringify(manifestSpec)}). ` +
    `Caret/tilde ranges let npm silently drift past the nix flake.`,
  );
}
if (manifestIsExact && manifestSpec !== flakeVersion) {
  errors.push(`package.json pins "@playwright/test" to ${manifestSpec} but flake.nix pins ${flakeVersion}.`);
}
if (lockVersion !== flakeVersion) {
  errors.push(`package-lock.json resolved @playwright/test@${lockVersion} but flake.nix pins ${flakeVersion}.`);
}

if (errors.length > 0) {
  console.error('Playwright version drift detected:');
  for (const e of errors) console.error('  - ' + e);
  console.error('');
  console.error('Fix by bumping BOTH together to the same exact version:');
  console.error('  1. Edit flake.nix:   playwright-web-flake/<VERSION>');
  console.error('  2. Run:              nix flake update playwright');
  console.error('  3. Edit package.json: "@playwright/test": "<VERSION>"  (no caret)');
  console.error('  4. Run:              npm install');
  console.error('');
  console.error('Current state:');
  console.error(`  flake.nix:         playwright-web-flake/${flakeVersion}`);
  console.error(`  package.json:      @playwright/test ${JSON.stringify(manifestSpec)}`);
  console.error(`  package-lock.json: @playwright/test ${lockVersion}`);
  process.exit(1);
}

console.log(`✓ Playwright versions in sync: ${flakeVersion}`);
