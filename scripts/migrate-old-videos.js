#!/usr/bin/env node

/**
 * One-time migration: rename video keys to 8-char format and copy originals
 * to the new S3 bucket so the Lambda re-transcodes them.
 *
 * For each video entry in media files:
 *   1. Generate new 8-char key
 *   2. Copy original from bike-app-video-originals/{old} → bike-video-originals/{prefix}/{new}
 *      (S3 upload trigger fires the Lambda to re-transcode automatically)
 *   3. Update media file: replace key, remove poster_key
 *
 * Supports two modes:
 *   - Wiki (default): routes in {CITY}/routes/{slug}/media.yml
 *   - Blog (--blog):  rides in blog/rides/ (recursive *-media.yml), prefix from git remote
 *
 * Usage:
 *   node scripts/migrate-old-videos.js --dry-run           # preview wiki migration
 *   node scripts/migrate-old-videos.js --blog --dry-run    # preview blog migration
 *   node scripts/migrate-old-videos.js --blog              # execute blog migration
 *
 * Requires:
 *   - AWS CLI configured with access to both buckets
 *   - CONTENT_DIR env or ../bike-routes (wiki) / ../bike-blog (blog)
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';

import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import yaml from 'js-yaml';

const SRC_BUCKET = 'bike-app-video-originals';
const DST_BUCKET = 'bike-video-originals';
const IS_BLOG = process.argv.includes('--blog');
const DRY_RUN = process.argv.includes('--dry-run');

function resolveContentDir() {
  if (process.env.CONTENT_DIR) return process.env.CONTENT_DIR;
  return IS_BLOG
    ? join(process.cwd(), '..', 'bike-blog')
    : join(process.cwd(), '..', 'bike-routes');
}

/** Derive video prefix from git remote: github.com:owner/repo → owner_repo */
function prefixFromGitRemote(contentDir) {
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      encoding: 'utf-8', cwd: contentDir, stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (match) return `${match[1]}_${match[2]}`;
  } catch { /* no remote */ }
  return null;
}

const CONTENT_DIR = resolveContentDir();
const PREFIX = IS_BLOG ? prefixFromGitRemote(CONTENT_DIR) : 'ottawa';

// Match the YAML serialization options used by the app (file-serializers.ts)
const YAML_OPTIONS = { flowLevel: -1, lineWidth: -1 };

function randomKey() {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  const limit = 252;
  let result = '';
  while (result.length < 8) {
    const bytes = randomBytes(16);
    for (const b of bytes) {
      if (b < limit && result.length < 8) {
        result += chars[b % 36];
      }
    }
  }
  return result;
}

function aws(cmd) {
  try {
    return execSync(`aws ${cmd}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    console.error(`  AWS CLI failed: ${err.message}`);
    return null;
  }
}

/** Wiki: routes/{slug}/media.yml — one level deep */
function findWikiMediaFiles() {
  const routesDir = join(CONTENT_DIR, 'ottawa', 'routes');
  const files = [];
  for (const slug of readdirSync(routesDir)) {
    const mediaPath = join(routesDir, slug, 'media.yml');
    try {
      statSync(mediaPath);
      files.push({ slug, path: mediaPath });
    } catch { /* no media.yml */ }
  }
  return files;
}

/** Blog: blog/rides/ recursive *-media.yml — nested year/month directories */
function findBlogMediaFiles() {
  const ridesDir = join(CONTENT_DIR, 'blog', 'rides');
  const files = [];

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (entry.endsWith('-media.yml')) {
        // slug = filename without -media.yml
        const slug = entry.replace(/-media\.yml$/, '');
        files.push({ slug, path: full });
      }
    }
  }

  walk(ridesDir);
  return files;
}

function findMediaYmlFiles() {
  return IS_BLOG ? findBlogMediaFiles() : findWikiMediaFiles();
}

async function main() {
  if (!PREFIX) {
    console.error('Could not determine video prefix. Set a git remote on the content repo or pass CONTENT_DIR.');
    process.exit(1);
  }
  console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Migrating old videos to ${DST_BUCKET}/${PREFIX}/\n`);

  const mediaFiles = findMediaYmlFiles();
  let totalVideos = 0;
  let totalCopied = 0;
  const keyMap = [];

  for (const { slug, path: mediaPath } of mediaFiles) {
    const raw = readFileSync(mediaPath, 'utf-8');
    const items = yaml.load(raw);
    if (!Array.isArray(items)) continue;

    let modified = false;

    for (const item of items) {
      if (item.type !== 'video') continue;
      totalVideos++;

      const oldKey = item.key;
      const newKey = randomKey();

      console.log(`  ${slug}: ${oldKey} → ${newKey}`);

      if (!DRY_RUN) {
        // Copy original — S3 trigger fires Lambda to re-transcode
        const result = aws(`s3 cp s3://${SRC_BUCKET}/${oldKey} s3://${DST_BUCKET}/${PREFIX}/${newKey}`);
        if (result !== null) {
          console.log(`    copied original`);
          totalCopied++;
        }
      }

      // Update media.yml entry
      item.key = newKey;
      delete item.poster_key;
      modified = true;

      keyMap.push({ slug, oldKey, newKey });
    }

    if (modified && !DRY_RUN) {
      const newYaml = yaml.dump(items, YAML_OPTIONS);
      writeFileSync(mediaPath, newYaml);
      console.log(`    updated ${mediaPath}`);
    }
  }

  console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Summary: ${totalVideos} videos found, ${DRY_RUN ? 'would copy' : 'copied'} ${DRY_RUN ? totalVideos : totalCopied}\n`);

  if (keyMap.length > 0) {
    console.log('Key mapping:');
    for (const { slug, oldKey, newKey } of keyMap) {
      console.log(`  ${slug}: ${oldKey} → ${newKey}`);
    }
  }

  if (!DRY_RUN && totalCopied > 0) {
    const repoDir = IS_BLOG ? '~/code/bike-blog' : '~/code/bike-routes';
    console.log('\nNext steps:');
    console.log(`  1. cd ${repoDir} && git diff    # review media file changes`);
    console.log('  2. git add -A && git commit -m "migrate video keys to 8-char format"');
    console.log(`  3. Verify videos load at https://videos.whereto.bike/${PREFIX}/{key}/{key}-h264.mp4`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
