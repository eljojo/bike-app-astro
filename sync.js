#!/usr/bin/env node

/**
 * Syncs template files from bike-app-astro into your blog repo.
 * Run from the blog repo: npm run sync
 *
 * Updates:
 *   - .github/workflows/ — CI/deploy/update actions (rendered from .tpl templates)
 *   - src/middleware.ts   — re-export of package middleware
 *   - src/content.config.ts — content collection config
 *   - scripts/setup.js   — interactive setup helper
 *   - astro.config.mjs   — Astro config
 *   - tsconfig.json      — TypeScript config
 */

import fs from 'node:fs';
import path from 'node:path';
import { renderTemplate, syncFile } from './packages/create-bike-blog/sync.js';

/** Read a top-level scalar from a simple YAML file. */
function readYamlField(filePath, field) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const re = new RegExp(`^${field}:\\s*["']?([^"'\\n]+?)["']?\\s*$`, 'm');
  const match = content.match(re);
  return match ? match[1] : '';
}

const cwd = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'));

const configPath = path.join(cwd, 'blog', 'config.yml');
if (!fs.existsSync(configPath)) {
  console.error('  Error: blog/config.yml not found. Is this a bike blog repo?');
  process.exit(1);
}

const vars = {
  FOLDER: pkg.name,
  DOMAIN: readYamlField(configPath, 'domain'),
  TIMEZONE: Intl.DateTimeFormat().resolvedOptions().timeZone,
};

// Templates live inside packages/create-bike-blog/templates/ relative to this file
const templateRoot = new URL('./packages/create-bike-blog/templates', import.meta.url).pathname;

if (!fs.existsSync(templateRoot)) {
  console.error('  Error: template directory not found at', templateRoot);
  process.exit(1);
}

let updated = 0;

// --- Sync CI workflows (.tpl rendered) ---
const workflowDir = path.join(templateRoot, 'github', 'workflows');
if (fs.existsSync(workflowDir)) {
  const outWorkflowDir = path.join(cwd, '.github', 'workflows');
  for (const file of fs.readdirSync(workflowDir)) {
    const outName = file.replace(/\.tpl$/, '');
    if (syncFile(path.join(workflowDir, file), path.join(outWorkflowDir, outName), vars)) {
      console.log(`  updated .github/workflows/${outName}`);
      updated++;
    }
  }
}

// --- Sync source files (copied as-is, no templating) ---
const sourceFiles = [
  'src/middleware.ts',
  'src/content.config.ts',
  'scripts/setup.js',
  'astro.config.mjs',
  'tsconfig.json',
];

for (const rel of sourceFiles) {
  const srcPath = path.join(templateRoot, rel);
  if (!fs.existsSync(srcPath)) continue;
  if (syncFile(srcPath, path.join(cwd, rel), vars)) {
    console.log(`  updated ${rel}`);
    updated++;
  }
}

// --- Summary ---
if (updated === 0) {
  console.log('  Everything is up to date.');
} else {
  console.log(`\n  ${updated} file(s) updated. Review and commit the changes.`);
}
