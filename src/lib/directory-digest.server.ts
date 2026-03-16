import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Compute an MD5 digest from an explicit list of file paths based on their mtimes.
 * Non-existent files are silently skipped.
 */
export function computeFileDigest(filePaths: string[]): string {
  const hash = createHash('md5');
  for (const fp of filePaths) {
    if (!fs.existsSync(fp)) continue;
    const stat = fs.statSync(fp);
    hash.update(`${path.basename(fp)}:${stat.mtimeMs}`);
  }
  return hash.digest('hex');
}

/**
 * Compute an MD5 digest of a directory based on file mtimes.
 * Includes top-level files and any files in the specified subdirectories.
 */
export function computeDirectoryDigest(
  dir: string,
  options?: { includeSubdirs?: string[] },
): string {
  const hash = createHash('md5');

  // Hash top-level files by their mtimes
  for (const file of fs.readdirSync(dir)) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isFile()) {
      hash.update(`${file}:${stat.mtimeMs}`);
    }
  }

  // Hash files in specified subdirectories
  for (const subdir of options?.includeSubdirs ?? []) {
    const subdirPath = path.join(dir, subdir);
    if (fs.existsSync(subdirPath)) {
      for (const file of fs.readdirSync(subdirPath)) {
        const filePath = path.join(subdirPath, file);
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          hash.update(`${subdir}/${file}:${stat.mtimeMs}`);
        }
      }
    }
  }

  return hash.digest('hex');
}
