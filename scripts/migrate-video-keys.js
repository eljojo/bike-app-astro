#!/usr/bin/env node

/**
 * One-time migration: copy existing unprefixed video objects in S3
 * to their new prefixed paths (e.g., `qm8ex84u` → `ottawa/qm8ex84u`).
 *
 * D1 and media.yml store just the 8-char key — no changes needed there.
 * This only copies S3 objects so Sippy and the new Lambda can find them.
 *
 * Usage:
 *   node scripts/migrate-video-keys.js \
 *     --prefix ottawa \
 *     --originals-bucket bike-video-originals \
 *     --outputs-bucket bike-video-outputs \
 *     --wrangler-env production
 *
 * Dry run (default): prints what would be copied.
 * Add --execute to actually copy.
 *
 * IMPORTANT: Run this BEFORE adding the S3 event notification (setup-aws-video.js),
 * otherwise the Lambda will fire on the copies and send webhook 404s.
 */

import { execSync } from 'node:child_process';

function aws(cmd, { silent = false, allowFailure = false } = {}) {
  try {
    const result = execSync(`aws ${cmd}`, {
      encoding: 'utf-8',
      stdio: silent ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'inherit'],
    });
    return result.trim();
  } catch (err) {
    if (allowFailure) return null;
    throw err;
  }
}

function parseArgs(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--execute') {
      opts.execute = true;
    } else if (args[i].startsWith('--')) {
      const key = args[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      opts[key] = args[i + 1] || true;
      if (typeof opts[key] === 'string') i++;
    }
  }
  return opts;
}

const args = parseArgs(process.argv.slice(2));
const prefix = args.prefix;
const originsBucket = args.originalsBucket || 'bike-video-originals';
const outputsBucket = args.outputsBucket || 'bike-video-outputs';
const wranglerEnv = args.wranglerEnv;
const dryRun = !args.execute;

if (!prefix) {
  console.error('Usage: migrate-video-keys.js --prefix <city> [--originals-bucket <name>] [--outputs-bucket <name>] [--wrangler-env <env>] [--execute]');
  process.exit(1);
}

// Step 1: Get video keys from D1
const envArg = wranglerEnv ? `--env ${wranglerEnv}` : '';
let keys = [];
try {
  const result = execSync(
    `npx wrangler d1 execute DB --config wrangler.jsonc ${envArg} --remote --command "SELECT key FROM video_jobs" --json`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const parsed = JSON.parse(result);
  keys = (parsed[0]?.results || []).map(r => r.key);
} catch (err) {
  console.error('Failed to query D1 video_jobs:', err.message);
  process.exit(1);
}

if (keys.length === 0) {
  console.log('No video keys found in D1. Nothing to migrate.');
  process.exit(0);
}

console.log(`Found ${keys.length} video key(s) to migrate to prefix "${prefix}/"\n`);
if (dryRun) {
  console.log('DRY RUN — add --execute to actually copy\n');
}

// Step 2: Copy each key
let copied = 0;
let skipped = 0;
let failed = 0;

for (const key of keys) {
  const src = key;
  const dest = `${prefix}/${key}`;

  // Check if already migrated (destination exists in originals)
  const exists = aws(`s3api head-object --bucket ${originsBucket} --key ${dest}`, { silent: true, allowFailure: true });
  if (exists !== null) {
    console.log(`  · ${key} → already migrated`);
    skipped++;
    continue;
  }

  // Copy original
  const originalExists = aws(`s3api head-object --bucket ${originsBucket} --key ${src}`, { silent: true, allowFailure: true });
  if (originalExists !== null) {
    if (dryRun) {
      console.log(`  → would copy s3://${originsBucket}/${src} → s3://${originsBucket}/${dest}`);
    } else {
      aws(`s3 cp s3://${originsBucket}/${src} s3://${originsBucket}/${dest}`, { silent: true });
      console.log(`  ✓ copied original: ${src} → ${dest}`);
    }
  }

  // Copy outputs (recursive — includes -av1.mp4, -h264.mp4, -poster.jpg)
  const outputList = aws(`s3 ls s3://${outputsBucket}/${src}/`, { silent: true, allowFailure: true });
  if (outputList) {
    if (dryRun) {
      console.log(`  → would copy s3://${outputsBucket}/${src}/ → s3://${outputsBucket}/${dest}/`);
    } else {
      aws(`s3 cp --recursive s3://${outputsBucket}/${src}/ s3://${outputsBucket}/${dest}/`, { silent: true });
      console.log(`  ✓ copied outputs: ${src}/ → ${dest}/`);
    }
  }

  if (dryRun) {
    copied++; // count as "would copy"
  } else {
    copied++;
  }
}

console.log(`\n${dryRun ? 'Would copy' : 'Copied'}: ${copied}, Skipped (already migrated): ${skipped}, Failed: ${failed}`);
if (dryRun && copied > 0) {
  console.log('\nRe-run with --execute to perform the migration.');
}
