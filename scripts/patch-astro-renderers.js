#!/usr/bin/env node
// Patches Astro's vite-plugin-renderers to not strip SSR renderers when all
// routes are injected (origin:"external") rather than file-based (origin:"project").
//
// The bug: Astro 6's hasNonPrerenderedProjectRoute() only checks origin:"project"
// routes. Since this project uses injectRoute() for all routes, Astro thinks there
// are no SSR pages and strips the Preact renderer — causing NoMatchingRenderer
// errors on every SSR page (/gate, /register, admin pages).
//
// This patch disables the optimization by replacing the condition with `false`.
// It's safe because the only effect of the optimization is a smaller bundle when
// renderers aren't needed — and we always need them.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve('node_modules/astro/dist/vite-plugin-renderers/index.js');
const marker = '!hasNonPrerenderedProjectRoute(options.routesList.routes';

let code;
try {
  code = readFileSync(file, 'utf8');
} catch {
  // astro not installed yet (e.g. during initial npm install)
  process.exit(0);
}

if (code.includes('false && ' + marker)) {
  console.log('[patch-astro-renderers] Already patched.');
  process.exit(0);
}

if (!code.includes(marker)) {
  console.warn('[patch-astro-renderers] Could not find the optimization to patch — Astro may have fixed the bug.');
  process.exit(0);
}

const patched = code.replace(marker, 'false && ' + marker);
writeFileSync(file, patched);
console.log('[patch-astro-renderers] Patched: disabled renderer stripping for injected routes.');
