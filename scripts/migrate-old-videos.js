#!/usr/bin/env node

/**
 * One-time migration: copy old videos from S3 eljojo-bike-prod to
 * S3 bike-video-outputs with new 8-char keys under ottawa/ prefix.
 *
 * For each video entry in media.yml:
 *   1. Generate new 8-char key
 *   2. Copy {old}/{old}-av1.mp4 → ottawa/{new}/{new}-av1.mp4
 *   3. Copy {old}/{old}-h264.mp4 → ottawa/{new}/{new}-h264.mp4
 *   4. Download poster from photos CDN → upload to ottawa/{new}/{new}-poster.0000000.jpg
 *   5. Update media.yml: replace key, remove poster_key
 *
 * Usage:
 *   node scripts/migrate-old-videos.js --dry-run     # preview changes
 *   node scripts/migrate-old-videos.js               # execute migration
 *
 * Requires:
 *   - AWS CLI configured with access to both buckets
 *   - CONTENT_DIR env or ../bike-routes exists
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import yaml from 'js-yaml';

const OLD_BUCKET = 'bike-app-video-outputs';
const NEW_BUCKET = 'bike-video-outputs';
const CITY = 'ottawa';
const PHOTOS_CDN = 'https://cdn.ottawabybike.ca';
const CONTENT_DIR = process.env.CONTENT_DIR || join(process.cwd(), '..', 'bike-routes');
const ROUTES_DIR = join(CONTENT_DIR, CITY, 'routes');
const DRY_RUN = process.argv.includes('--dry-run');

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

async function downloadPoster(posterKey) {
  const url = `${PHOTOS_CDN}/${posterKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`  Failed to download poster ${posterKey}: ${res.status}`);
    return null;
  }
  return Buffer.from(await res.arrayBuffer());
}

function findMediaYmlFiles() {
  const files = [];
  for (const slug of readdirSync(ROUTES_DIR)) {
    const mediaPath = join(ROUTES_DIR, slug, 'media.yml');
    try {
      statSync(mediaPath);
      files.push({ slug, path: mediaPath });
    } catch { /* no media.yml */ }
  }
  return files;
}

async function main() {
  console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Migrating old videos to ${NEW_BUCKET}/${CITY}/\n`);

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
      const posterKey = item.poster_key;

      console.log(`  ${slug}: ${oldKey} → ${newKey}`);

      if (!DRY_RUN) {
        // Copy AV1
        const av1Result = aws(`s3 cp s3://${OLD_BUCKET}/${oldKey}/${oldKey}-av1.mp4 s3://${NEW_BUCKET}/${CITY}/${newKey}/${newKey}-av1.mp4`);
        if (av1Result !== null) console.log(`    copied av1`);

        // Copy H.264
        const h264Result = aws(`s3 cp s3://${OLD_BUCKET}/${oldKey}/${oldKey}-h264.mp4 s3://${NEW_BUCKET}/${CITY}/${newKey}/${newKey}-h264.mp4`);
        if (h264Result !== null) console.log(`    copied h264`);

        // Download poster from photos CDN, upload to videos bucket
        if (posterKey) {
          const posterData = await downloadPoster(posterKey);
          if (posterData) {
            const tmpPath = `/tmp/poster-${newKey}.jpg`;
            writeFileSync(tmpPath, posterData);
            aws(`s3 cp ${tmpPath} s3://${NEW_BUCKET}/${CITY}/${newKey}/${newKey}-poster.0000000.jpg --content-type image/jpeg`);
            console.log(`    copied poster (from ${posterKey})`);
          }
        }

        totalCopied++;
      }

      // Update media.yml entry
      item.key = newKey;
      delete item.poster_key;
      modified = true;

      keyMap.push({ slug, oldKey, newKey, posterKey });
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
    console.log('\nNext steps:');
    console.log('  1. cd ~/code/bike-routes && git diff    # review media.yml changes');
    console.log('  2. git add -A && git commit -m "migrate video keys to 8-char format"');
    console.log('  3. Verify videos load at https://videos.whereto.bike/ottawa/{key}/{key}-h264.mp4');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
