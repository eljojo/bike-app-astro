// After an incremental build, merges the new dist/ output with the
// cached dist/ from the previous build.
//
// Usage: npx tsx scripts/merge-incremental-build.ts
//
// Expects:
//   dist/         — current build output (may be partial in incremental mode)
//   dist-cache/   — cached dist/ from previous build (restored by CI)
//
// Behavior:
//   Full mode:    dist/ replaces dist-cache/ entirely
//   Incremental:  new files from dist/ are copied into dist-cache/, then
//                 dist-cache/ becomes the new dist/

import fs from 'node:fs';
import path from 'node:path';
import { loadBuildPlan } from '../src/lib/content/build-plan.server';

const DIST = path.join(process.cwd(), 'dist');
const DIST_CACHE = path.join(process.cwd(), 'dist-cache');

const plan = loadBuildPlan();

if (!plan || plan.mode === 'full' || !fs.existsSync(DIST_CACHE)) {
  // Full build — replace cache with current dist
  if (fs.existsSync(DIST_CACHE)) fs.rmSync(DIST_CACHE, { recursive: true });
  if (fs.existsSync(DIST)) {
    fs.cpSync(DIST, DIST_CACHE, { recursive: true });
    console.log('Full build: cached dist/ for next incremental build');
  }
} else {
  // Incremental build — merge new pages into cached dist
  let copied = 0;

  // Copy all files from new dist/ into cached dist/ (overwriting existing)
  copyRecursive(DIST, DIST_CACHE);

  // Handle deleted slugs — remove their pages from cached dist
  for (const key of plan.deletedSlugs) {
    const [type, ...slugParts] = key.split(':');
    const slug = slugParts.join(':');
    const patterns = getDeletePatterns(type, slug);
    for (const pattern of patterns) {
      const target = path.join(DIST_CACHE, 'client', pattern);
      if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true });
        console.log(`  Deleted: ${pattern}`);
      }
    }
  }

  // Replace dist/ with merged result for deployment
  fs.rmSync(DIST, { recursive: true });
  fs.renameSync(DIST_CACHE, DIST);

  console.log(`Incremental merge complete (${copied} files updated)`);

  function copyRecursive(src: string, dest: string) {
    if (!fs.existsSync(src)) return;
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        if (!fs.existsSync(destPath)) fs.mkdirSync(destPath, { recursive: true });
        copyRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
        copied++;
      }
    }
  }
}

function getDeletePatterns(type: string, slug: string): string[] {
  switch (type) {
    case 'ride':
      return [`rides/${slug}/`, `rides/${slug}.html`];
    case 'tour-ride':
      // slug is "tourSlug/rideSlug" — clean up tour-specific pages
      return [`tours/${slug}/`, `tours/${slug}.html`];
    case 'route':
      return [`routes/${slug}/`, `routes/${slug}.html`];
    case 'event':
      return [`events/${slug}/`, `events/${slug}.html`];
    case 'place':
      return [`places/${slug}/`, `places/${slug}.html`];
    default:
      return [];
  }
}
