#!/usr/bin/env node

/**
 * Syncs template files from the bike-app-astro package into your blog repo.
 * Run from the blog repo: npm run sync
 *
 * Updates:
 *   - .github/workflows/ — CI/deploy/update actions (rendered from .tpl templates)
 *   - src/middleware.ts   — re-export of package middleware
 *   - scripts/setup.js   — interactive setup helper
 *   - astro.config.mjs    — Astro config
 *   - tsconfig.json       — TypeScript config
 */

import fs from 'node:fs';
import path from 'node:path';

function renderTemplate(content, vars) {
  return content.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return key in vars ? vars[key] : match;
  });
}

function parseEnv(envPath) {
  if (!fs.existsSync(envPath)) return {};
  const vars = {};
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const match = line.match(/^(\w+)=(.*)$/);
    if (match) vars[match[1]] = match[2];
  }
  return vars;
}

function syncFile(srcPath, destPath, vars) {
  let content = fs.readFileSync(srcPath, 'utf-8');
  if (srcPath.endsWith('.tpl')) {
    content = renderTemplate(content, vars);
  }

  const existing = fs.existsSync(destPath) ? fs.readFileSync(destPath, 'utf-8') : null;
  if (existing !== content) {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, content);
    return true;
  }
  return false;
}

const cwd = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'));
const env = parseEnv(path.join(cwd, '.env'));

const vars = {
  FOLDER: pkg.name,
  DOMAIN: (env.SITE_URL || '').replace(/^https?:\/\//, ''),
  USERNAME: env.CITY || 'blog',
  TIMEZONE: Intl.DateTimeFormat().resolvedOptions().timeZone,
};

const templateRoot = new URL('./templates', import.meta.url).pathname;
let updated = 0;

// --- Sync CI workflows (.tpl rendered) ---
const workflowDir = path.join(templateRoot, 'github', 'workflows');
const outWorkflowDir = path.join(cwd, '.github', 'workflows');
for (const file of fs.readdirSync(workflowDir)) {
  const outName = file.replace(/\.tpl$/, '');
  if (syncFile(path.join(workflowDir, file), path.join(outWorkflowDir, outName), vars)) {
    console.log(`  updated .github/workflows/${outName}`);
    updated++;
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
