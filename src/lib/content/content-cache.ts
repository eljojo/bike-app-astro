// Persistent disk cache for admin loader data.
// Stores per-item shapes keyed by file digest. On cache hit, the admin loader
// skips readRideFile()/readRouteDir() entirely — the expensive GPX parsing,
// metric computation, and hash calculation are avoided.
//
// Cache files live in .astro/cache/ and are preserved between CI builds
// via GitHub Actions cache.

import fs from 'node:fs';
import path from 'node:path';

export interface ContentCacheEntry<T = unknown> {
  digest: string;
  data: T;
}

export interface ContentCache<T = unknown> {
  version: number;
  entries: Record<string, ContentCacheEntry<T>>;
}

/**
 * Read a content cache from disk.
 * Returns empty entries if the file doesn't exist, is corrupted, or version mismatches.
 */
export function readContentCache<T = unknown>(
  filePath: string,
  expectedVersion: number,
): ContentCache<T> {
  try {
    if (!fs.existsSync(filePath)) return { version: expectedVersion, entries: {} };
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as ContentCache<T>;
    if (parsed.version !== expectedVersion) return { version: expectedVersion, entries: {} };
    return parsed;
  } catch {
    return { version: expectedVersion, entries: {} };
  }
}

/**
 * Write a content cache to disk, creating directories as needed.
 */
export function writeContentCache<T>(
  filePath: string,
  version: number,
  entries: Record<string, ContentCacheEntry<T>>,
): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ version, entries } satisfies ContentCache<T>));
}
